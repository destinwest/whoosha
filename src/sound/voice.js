// ── voice ────────────────────────────────────────────────────────────────────
// Generic spoken-cue player — the game-agnostic generalization of the original
// Star-only player (since removed). A "voice pack" is just a map of cue → clip URL, e.g.
//   { in: '/sounds/Faith/FaithBreatheIn.mp3', out: '…', hold: '…', intro: '…' }
// Any cue whose clip is absent from the pack simply no-ops when played, so a
// pack can ship without a 'hold' (or 'intro') and gain it later.
//
// Deliberately SAMPLED, not synthesized: the "cued/breath-coupled elements stay
// synthesized" rule (POLISH-STRATEGY 2026-06-02) is about material synthesis
// handles well — spoken words aren't in that set. Deliberately NOT the full SoundDirector: nothing here outlives
// a single clip — each cue is a fresh one-shot AudioBufferSource — so there is
// no persistent graph for an iOS lock/unlock to leave broken. Runs on the app's
// shared AudioContext (see sharedContext.js), handed in by useVoice.
//
// Usage (see useVoice.js for the React wrapper):
//   const voice = createVoice(ctx, VOICES[id].clips)
//   await voice.ready                    // resolves once clips are decoded
//   voice.play('in' | 'out' | 'hold' | 'intro')   // returns true/false
//   voice.output.connect(master); voice.stop(); voice.dispose()

const PEAK_GAIN  = 0.85   // cue volume at full fade-in
const FADE_IN_S  = 0.15   // quick — clips are short spoken words, not a swell
const FADE_OUT_S = 0.35   // gentle settle so it doesn't clip off mid-word
const CUT_FADE_S = 0.05   // if a new cue interrupts a still-playing one

export function createVoice(ctx, files) {
  const output = ctx.createGain()
  output.gain.value = 1

  const buffers = {}
  let disposed  = false

  // Load + decode every clip in the pack in parallel. A failure must not break
  // the game — the pacing circle + track remain the primary guide; voice is an
  // enhancement. A failed clip just means play() no-ops for that cue.
  const ready = Promise.all(
    Object.entries(files || {}).map(async ([kind, url]) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`voice: fetch failed (${res.status}) for ${url}`)
      const arrayBuffer = await res.arrayBuffer()
      const buffer      = await ctx.decodeAudioData(arrayBuffer)
      if (!disposed) buffers[kind] = buffer
    }),
  ).catch((err) => {
    console.warn('voice: failed to load one or more cues', err)
  })

  let activeSource = null
  let activeGain   = null

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

  // Returns true if the cue actually started, false if skipped (disposed, or the
  // clip isn't loaded — not in this pack, or still decoding). Callers retry on
  // the next frame so the first cue at game start isn't missable.
  function play(kind) {
    if (disposed) return false
    const buffer = buffers[kind]
    if (!buffer) return false

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

  function stop() { stopActive() }

  function dispose() {
    disposed = true
    stopActive()
    try { output.disconnect() } catch (e) {}
  }

  return { output, play, stop, dispose, ready }
}
