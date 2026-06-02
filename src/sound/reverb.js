// ── reverb ─────────────────────────────────────────────────────────────────
// Synthesized room reverb for the synth breath. Generates an impulse
// response once at construction (exponentially-decaying stereo noise —
// classic algorithmic-reverb approach) and uses it via a ConvolverNode.
//
// The IR is pre-filtered with a lowpass so the reverb tail rolls off in
// the highs — suggests "outdoor enclosure" (forest, soft surfaces) rather
// than "tile bathroom." Combined with the existing ambient bed, the
// resulting space reads as "the breath is happening inside the same
// place the ambience is happening inside."
//
// CPU cost: one convolution per audio frame across a 2s IR — Web Audio
// handles this on its own thread with no JS overhead, so it's effectively
// free at runtime.

const IR_DURATION_S = 2.0      // total reverb tail length in seconds
const IR_DECAY      = 3.5      // higher = faster decay
const DAMPING_HZ    = 4500     // pre-convolver lowpass — rolls off reflections in highs
const DAMPING_Q     = 0.7

// Generates a stereo impulse response — exponentially decaying noise.
// Independent random sequences per channel give natural stereo spread in
// the reverb tail.
function makeImpulseResponse(ctx) {
  const sampleRate = ctx.sampleRate
  const length     = Math.floor(sampleRate * IR_DURATION_S)
  const buffer     = ctx.createBuffer(2, length, sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const channelData = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, IR_DECAY)
      channelData[i] = (Math.random() * 2 - 1) * decay
    }
  }
  return buffer
}

export function createReverb(ctx) {
  // Pre-filter: lowpass before convolution suggests soft / absorbent
  // surfaces (forest, padded room) rather than reflective (tile, glass).
  const input = ctx.createBiquadFilter()
  input.type = 'lowpass'
  input.frequency.value = DAMPING_HZ
  input.Q.value = DAMPING_Q

  const convolver = ctx.createConvolver()
  convolver.buffer = makeImpulseResponse(ctx)

  const output = ctx.createGain()
  output.gain.value = 1.0  // caller controls send level externally via a wet-send gain node

  input.connect(convolver).connect(output)

  return {
    input,
    output,
    dispose() {
      try { input.disconnect()     } catch (e) {}
      try { convolver.disconnect() } catch (e) {}
      try { output.disconnect()    } catch (e) {}
    },
  }
}
