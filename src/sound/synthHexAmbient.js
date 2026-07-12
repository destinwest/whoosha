// ── synthHexAmbient ──────────────────────────────────────────────────────
// Continuous ambient bed for the Hexagon game — the Hexagon counterpart to
// synthAmbient.js. Same technique, different asset: sits beneath the hex
// breath as the foundation layer of the soundscape. Standalone (not shared
// with Square's module) so hexagon audio stays independent — mirrors the
// synthBreath / synthHexBreath split.
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
//   2. The file's stereo channels are near-identical (effectively mono
//      content in a stereo container — confirmed via channel-difference
//      analysis, same situation as Square's bed). A mono-sounding source on
//      headphones reads as "stuck in the middle of the head." Solved with
//      Haas-effect widening: the same signal is delayed ~12ms on one channel
//      relative to the other, which the brain interprets as spatial width.
//      Collapses gracefully on phone speakers (where stereo is meaningless
//      anyway).
//
// Loading is asynchronous — createHexAmbient returns a Promise. The caller
// fires it and continues; the ambient fades in whenever it's ready. The hex
// breath plays in the interim without waiting.

const FILE_URL      = '/sounds/hexGameAmbience.mp3'
const PEAK_GAIN      = 0.12         // matches Square's ambient bed level — present but never foreground
const CROSSFADE_S    = 5            // overlap duration at every loop seam
const HAAS_DELAY_S   = 0.012        // ~12ms — sweet spot for stereo widening from mono
const FADE_IN_S      = 3            // ambient swells in over this duration at start
const LOOKAHEAD_S    = 8            // ensure next scheduled source is at least this far ahead

export async function createHexAmbient(ctx) {
  // ── Fetch + decode ──
  const response = await fetch(FILE_URL)
  if (!response.ok) {
    throw new Error(`synthHexAmbient: fetch failed (${response.status}) for ${FILE_URL}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer      = await ctx.decodeAudioData(arrayBuffer)

  // ── Output gain ──
  // Starts at 0; ramps to PEAK_GAIN over FADE_IN_S so the bed materializes
  // softly rather than slamming in at full level.
  const output = ctx.createGain()
  output.gain.value = 0

  // ── Stereo widening (Haas-effect on near-mono input) ──
  const widenInput = ctx.createGain()
  const delay      = ctx.createDelay(0.05)
  const merger     = ctx.createChannelMerger(2)
  delay.delayTime.value = HAAS_DELAY_S

  widenInput.connect(merger, 0, 0)   // direct → L
  widenInput.connect(delay)
  delay.connect(merger, 0, 1)        // delayed → R
  merger.connect(output)

  // ── Crossfade loop scheduler ──
  // Same overlapping-playback approach as synthAmbient.js — see that file
  // for the full rationale.
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

    envelope.gain.setValueAtTime(0, startTime)
    envelope.gain.linearRampToValueAtTime(1, startTime + CROSSFADE_S)
    envelope.gain.setValueAtTime(1, endTime - CROSSFADE_S)
    envelope.gain.linearRampToValueAtTime(0, endTime)

    source.start(startTime)
    source.stop(endTime + 0.1)

    activeSources.add(source)
    source.onended = () => {
      activeSources.delete(source)
      try { source.disconnect()   } catch (e) {}
      try { envelope.disconnect() } catch (e) {}
    }

    nextStartTime = endTime - CROSSFADE_S
  }

  function ensureFutureBuffered() {
    if (disposed) return
    while (nextStartTime < ctx.currentTime + LOOKAHEAD_S) {
      spawnSource()
    }
  }

  ensureFutureBuffered()

  const now = ctx.currentTime
  output.gain.setValueAtTime(0, now)
  output.gain.linearRampToValueAtTime(PEAK_GAIN, now + FADE_IN_S)

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
