// ── synthAmbient ───────────────────────────────────────────────────────────
// Continuous forest-meadow ambient bed for the Square game. Sits beneath the
// synth breath as the foundation layer of the regulated-state soundscape —
// the "place" the breath is happening inside.
//
// Two complications the source file presents are handled here so the caller
// doesn't have to know about them:
//
//   1. The file is not authored as a loop. Naïve loop playback would
//      produce an audible click/thud at every seam. Solved by scheduling
//      overlapping playbacks with crossfade envelopes — by the time one
//      copy is fading out, the next is fading in at the same point in the
//      file, smoothing across the seam.
//
//   2. The file is mono. A mono source on headphones sounds "stuck in the
//      middle of the head." Solved with Haas-effect widening: the same
//      signal is delayed ~12ms on one channel relative to the other, which
//      the brain interprets as spatial width. Collapses gracefully on
//      phone speakers (where stereo is meaningless anyway).
//
// Loading is asynchronous — createAmbient returns a Promise. SoundDirector
// fires it and continues; the ambient fades in whenever it's ready (usually
// within a few hundred ms on a warm cache, possibly seconds on cold first
// load). The synth breath plays in the interim without waiting.

const FILE_URL    = '/sounds/squareGameAmbience.mp3'
const PEAK_GAIN   = 0.12          // bed volume — present but never foreground
const CROSSFADE_S = 5             // overlap duration at every loop seam
const HAAS_DELAY_S = 0.012        // ~12ms — sweet spot for stereo widening from mono
const FADE_IN_S   = 3             // ambient swells in over this duration at start
const LOOKAHEAD_S = 8             // ensure next scheduled source is at least this far ahead

export async function createAmbient(ctx) {
  // ── Fetch + decode ──
  // decodeAudioData is also async; combined latency is typically 100–500ms
  // for a 2-minute MP3 on a fast device. Caller handles the case where this
  // resolves after the rest of the audio graph is already running.
  const response = await fetch(FILE_URL)
  if (!response.ok) {
    throw new Error(`synthAmbient: fetch failed (${response.status}) for ${FILE_URL}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer      = await ctx.decodeAudioData(arrayBuffer)

  // ── Output gain ──
  // Starts at 0; ramps to PEAK_GAIN over FADE_IN_S so the bed materializes
  // softly rather than slamming in at full level. SoundDirector's
  // dysregulation ducker writes additional automation to this same gain
  // (via the ambient bus chain it routes into).
  const output = ctx.createGain()
  output.gain.value = 0

  // ── Stereo widening (Haas-effect on mono input) ──
  // Channel routing:
  //   widenInput → ChannelMerger.channel 0 (direct, no delay) — left
  //   widenInput → Delay(12ms) → ChannelMerger.channel 1     — right
  // Inter-aural time difference of ~10–30ms reads to the brain as spatial
  // width without adding any decorrelated content. Works on headphones;
  // on speakers (especially phone speakers <5cm apart) it's a no-op
  // perceptually because the channels mix acoustically anyway.
  const widenInput = ctx.createGain()
  const delay      = ctx.createDelay(0.05)
  const merger     = ctx.createChannelMerger(2)
  delay.delayTime.value = HAAS_DELAY_S

  widenInput.connect(merger, 0, 0)   // direct → L
  widenInput.connect(delay)
  delay.connect(merger, 0, 1)        // delayed → R
  merger.connect(output)

  // ── Crossfade loop scheduler ──
  // Each playback of the file is a fresh AudioBufferSourceNode (they can't
  // be reused after stop). Each has its own gain envelope that fades in
  // over CROSSFADE_S at the start and fades out over CROSSFADE_S at the
  // end. We schedule new sources to start exactly when the previous one
  // begins fading out — so the two fades overlap and sum to ~1.0, hiding
  // the seam.
  //
  // ensureFutureBuffered() keeps at least LOOKAHEAD_S of audio scheduled
  // ahead of audioContext.currentTime, and is polled once per second. The
  // polling is in wall-clock time but the checks against ctx.currentTime
  // are robust across pause/resume — when the context suspends (tab hidden,
  // etc.) ctx.currentTime pauses too, so the lookahead check sees no time
  // passing and schedules nothing new during the pause.
  let nextStartTime = ctx.currentTime
  let disposed      = false
  const activeSources = new Set()

  function spawnSource() {
    if (disposed) return

    const source   = ctx.createBufferSource()
    source.buffer  = buffer

    const envelope = ctx.createGain()
    source.connect(envelope).connect(widenInput)

    const startTime = Math.max(nextStartTime, ctx.currentTime)
    const endTime   = startTime + buffer.duration

    // Crossfade envelope — fade in at start, fade out at end.
    envelope.gain.setValueAtTime(0, startTime)
    envelope.gain.linearRampToValueAtTime(1, startTime + CROSSFADE_S)
    envelope.gain.setValueAtTime(1, endTime - CROSSFADE_S)
    envelope.gain.linearRampToValueAtTime(0, endTime)

    source.start(startTime)
    source.stop(endTime + 0.1)  // small grace period past the fade-out

    activeSources.add(source)
    source.onended = () => {
      activeSources.delete(source)
      try { source.disconnect()   } catch (e) {}
      try { envelope.disconnect() } catch (e) {}
    }

    // Next source begins exactly when this one starts fading out, so
    // their envelopes overlap by CROSSFADE_S seconds.
    nextStartTime = endTime - CROSSFADE_S
  }

  function ensureFutureBuffered() {
    if (disposed) return
    while (nextStartTime < ctx.currentTime + LOOKAHEAD_S) {
      spawnSource()
    }
  }

  // Schedule the first two playbacks immediately so the crossfade has
  // something to crossfade BETWEEN as the first one nears its end.
  ensureFutureBuffered()

  // ── Game-start fade-in ──
  // Audible playback begins now (the first source's envelope ramps from 0
  // to 1 over CROSSFADE_S). The outer output gain on top adds an additional
  // game-start swell over FADE_IN_S so the bed materializes softly — feels
  // like the world is arriving, not like someone hit play.
  const now = ctx.currentTime
  output.gain.setValueAtTime(0, now)
  output.gain.linearRampToValueAtTime(PEAK_GAIN, now + FADE_IN_S)

  // Recurring re-check every second to keep the schedule healthy for as
  // long as playback continues.
  const intervalId = setInterval(ensureFutureBuffered, 1000)

  return {
    output,
    dispose() {
      disposed = true
      clearInterval(intervalId)
      activeSources.forEach((s) => { try { s.stop() } catch (e) {} })
      activeSources.clear()
      try { output.disconnect()     } catch (e) {}
      try { merger.disconnect()     } catch (e) {}
      try { delay.disconnect()      } catch (e) {}
      try { widenInput.disconnect() } catch (e) {}
    },
  }
}
