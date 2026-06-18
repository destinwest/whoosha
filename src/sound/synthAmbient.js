// ── synthAmbient ───────────────────────────────────────────────────────────
// Continuous forest-meadow ambient bed for the Square game. Sits beneath the
// synth breath as the foundation layer of the regulated-state soundscape —
// the "place" the breath is happening inside.
//
// ── Why an HTMLMediaElement, not an AudioBufferSourceNode ──
// The bed plays from a durable <audio> element routed into the graph via a
// MediaElementAudioSourceNode, rather than from decoded AudioBufferSourceNodes.
// The reason is iOS audio-session interruptions (backgrounding, phone calls,
// another app grabbing audio): they STOP every playing AudioBufferSourceNode,
// and those nodes are one-shot — once stopped they're dead and must be rebuilt.
// A media element is owned by the browser's media pipeline instead; it survives
// the interruption and resumes (on its own, or via play() — see resume()). So
// the bed never participates in SoundDirector's source-rebuild path.
//
// Two file properties are still handled here so the caller doesn't have to:
//
//   1. Looping. The element loops natively (el.loop = true). The source file
//      should be authored to loop cleanly; if an audible seam appears at the
//      wrap, the follow-up is a two-element crossfade — but native loop is the
//      simplest thing that can work and is tried first.
//
//   2. The file is mono. A mono source on headphones sounds "stuck in the
//      middle of the head." Solved with Haas-effect widening: the same
//      signal is delayed ~12ms on one channel relative to the other, which
//      the brain interprets as spatial width. Collapses gracefully on
//      phone speakers (where stereo is meaningless anyway).
//
// createAmbient is synchronous: the element loads in the background and starts
// when buffered, while the output-gain fade-in gives the soft entrance. The
// synth breath plays in the interim without waiting.

const FILE_URL     = '/sounds/squareGameAmbience.mp3'
const PEAK_GAIN    = 0.12          // bed volume — present but never foreground
const HAAS_DELAY_S = 0.012         // ~12ms — sweet spot for stereo widening from mono
const FADE_IN_S    = 3             // ambient swells in over this duration at start

export function createAmbient(ctx) {
  // ── Durable media-element source ──
  const el = new Audio()
  el.src     = FILE_URL
  el.loop    = true
  el.preload = 'auto'
  // No crossOrigin: the asset is same-origin, so the MediaElementSource is
  // never tainted. (Setting 'anonymous' here would only matter for a CORS CDN,
  // and would silently mute the bed if that CDN didn't send CORS headers.)

  // createMediaElementSource may be called only ONCE per element. We create a
  // fresh element per createAmbient call, so this is safe across game mounts.
  const source = ctx.createMediaElementSource(el)

  // ── Output gain ──
  // Starts at 0; ramps to PEAK_GAIN over FADE_IN_S so the bed materializes
  // softly rather than slamming in. SoundDirector's dysregulation ducker writes
  // additional automation downstream (via the ambientBedGain it connects into).
  const output = ctx.createGain()
  output.gain.value = 0

  // ── Stereo widening (Haas-effect on mono input) ──
  // Channel routing:
  //   source → ChannelMerger.channel 0 (direct, no delay) — left
  //   source → Delay(12ms) → ChannelMerger.channel 1       — right
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

  source.connect(widenInput)

  // Start playback. play() can reject if the element hasn't earned autoplay
  // credit yet (no gesture, suspended context); SoundDirector's unlock and
  // visibilitychange handlers call resume() to re-assert it. The output-gain
  // fade-in runs regardless — when audio actually begins it's already ramping.
  el.play().catch(() => {})

  const now = ctx.currentTime
  output.gain.setValueAtTime(0, now)
  output.gain.linearRampToValueAtTime(PEAK_GAIN, now + FADE_IN_S)

  let disposed = false

  return {
    output,

    // ── resume ──
    // Re-assert playback after an iOS interruption/resume. iOS may pause the
    // element when it interrupts the audio session; calling play() on
    // foreground return brings the bed back without rebuilding any node.
    // Cheap and idempotent — safe to call on every visibility/unlock event.
    resume() {
      if (disposed) return
      el.play().catch(() => {})
    },

    // ── dispose ──
    // Final teardown for a game session. Pauses and releases the element and
    // disconnects the routing nodes. NOT called by the source-rebuild path —
    // the bed is durable and outlives interruption recovery.
    dispose() {
      disposed = true
      try { el.pause() } catch (e) {}
      el.src = ''
      try { el.load() } catch (e) {}   // release the network/decoder resource
      try { source.disconnect()     } catch (e) {}
      try { output.disconnect()     } catch (e) {}
      try { merger.disconnect()     } catch (e) {}
      try { delay.disconnect()      } catch (e) {}
      try { widenInput.disconnect() } catch (e) {}
    },
  }
}
