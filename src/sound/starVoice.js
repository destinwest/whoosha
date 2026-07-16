// ── starVoice ──────────────────────────────────────────────────────────────
// Spoken-word cues for the Star game:
//   'in' / 'out'  — "breathe in" / "breathe out", one per breath-phase
//                   transition, fading in and settling out around the clip so
//                   it sits cleanly inside its 4s phase.
//   'intro'       — a one-shot ~5.4s piece played once at game open (see the
//                   trigger in StarGame — this module only knows how to play
//                   it, not when).
//
// This is deliberately SAMPLED, not synthesized — synthesis in this codebase
// makes tones/ambience, not speech, so the "cued/breath-coupled elements stay
// synthesized" rule (POLISH-STRATEGY 2026-06-02 decision log) doesn't apply
// here; that rule is about material synthesis handles well, and spoken words
// aren't in that set.
//
// Deliberately NOT the full SoundDirector: no bus spine, no interruption-
// recovery state machine. Nothing here outlives a single clip — each cue is a
// fresh one-shot AudioBufferSource fired against whatever state the context
// happens to be in — so there's no persistent graph for an iOS lock/unlock to
// leave broken. Runs on the app's shared AudioContext (see sharedContext.js),
// handed in by useStarVoice; this module only owns its own nodes.
//
// Usage (see useStarVoice.js for the React wrapper):
//   const voice = createStarVoice(ctx)
//   await voice.ready                 // resolves once all clips are decoded
//   voice.play('in' | 'out' | 'intro') // fire a cue (returns true/false — see
//                                      // play()); cuts any still-fading prior
//                                      // one short
//   voice.output.connect(master)
//   voice.dispose()

const FILES = {
  in:     '/sounds/BreatheIn.mp3',
  out:    '/sounds/BreatheOut.mp3',
  intro:  '/sounds/StarGameBreathIntro.mp3',
}

const PEAK_GAIN     = 0.85   // cue volume at full fade-in
const FADE_IN_S     = 0.15   // quick — clips are short spoken words, not a swell
const FADE_OUT_S    = 0.35   // gentle settle so it doesn't clip off mid-word
const CUT_FADE_S    = 0.05   // if a new cue interrupts a still-playing one

export function createStarVoice(ctx) {
  const output = ctx.createGain()
  output.gain.value = 1

  const buffers  = {}
  let disposed   = false

  // ── Load + decode both clips in parallel ──
  // Failure here must not break the game — the pacing circle + track remain
  // the primary guide; voice is an enhancement. A load failure just means
  // play() silently no-ops for that cue.
  const ready = Promise.all(
    Object.entries(FILES).map(async ([kind, url]) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`starVoice: fetch failed (${res.status}) for ${url}`)
      const arrayBuffer = await res.arrayBuffer()
      const buffer      = await ctx.decodeAudioData(arrayBuffer)
      if (!disposed) buffers[kind] = buffer
    }),
  ).catch((err) => {
    console.warn('starVoice: failed to load one or more cues', err)
  })

  let activeSource = null
  let activeGain   = null

  // Cuts a still-playing cue short with a quick fade, in case a phase change
  // fires again before the previous cue finished (shouldn't happen at the
  // normal 4s cadence — clips are ~1–1.5s — but a rapid dev-tool timeline
  // scrub or similar shouldn't leave two cues overlapping).
  function stopActive() {
    if (!activeSource) return
    const now = ctx.currentTime
    try {
      activeGain.gain.cancelScheduledValues(now)
      activeGain.gain.setValueAtTime(activeGain.gain.value, now)
      activeGain.gain.linearRampToValueAtTime(0, now + CUT_FADE_S)
      activeSource.stop(now + CUT_FADE_S + 0.02)
    } catch (e) { /* already stopped */ }
    activeSource = null
    activeGain   = null
  }

  // Returns true if the cue actually started, false if skipped (disposed, or
  // the clip hasn't finished decoding yet). The caller (useStarVoice → StarGame)
  // uses this to RETRY on the next frame rather than silently losing the cue —
  // important for the very first "breathe in" at game start, which must not be
  // missable (see the onBreath call site in StarCanvas for the fuller story).
  function play(kind) {
    if (disposed) return false
    const buffer = buffers[kind]
    if (!buffer) return false   // not loaded yet (only possible in the first ~200ms) — caller retries

    stopActive()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 0
    source.connect(gain).connect(output)

    const now = ctx.currentTime
    const dur = buffer.duration
    const fadeOutStart = Math.max(now + FADE_IN_S, now + dur - FADE_OUT_S)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + FADE_IN_S)
    gain.gain.setValueAtTime(PEAK_GAIN, fadeOutStart)
    gain.gain.linearRampToValueAtTime(0, fadeOutStart + FADE_OUT_S)

    const stopAt = fadeOutStart + FADE_OUT_S + 0.05
    source.start(now)
    source.stop(stopAt)

    activeSource = source
    activeGain   = gain
    source.onended = () => {
      try { source.disconnect() } catch (e) {}
      try { gain.disconnect()   } catch (e) {}
      if (activeSource === source) { activeSource = null; activeGain = null }
    }
    return true
  }

  // Immediately (quick-fade) silences any in-flight cue — called when the game
  // exits to the completion screen, mirroring how SoundDirector/useHexBreath
  // proactively stop their (continuous) audio on exit rather than letting it
  // linger under the completion card. Safe to call with nothing playing.
  function stop() {
    stopActive()
  }

  function dispose() {
    disposed = true
    stopActive()
    try { output.disconnect() } catch (e) {}
  }

  return { output, play, stop, dispose, ready }
}
