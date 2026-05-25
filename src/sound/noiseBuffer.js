// ── noiseBuffer ────────────────────────────────────────────────────────────
// Pre-generates pink and brown noise AudioBuffers that the ambient synth
// modules loop indefinitely. Generation runs once at SoundDirector startup
// (~50ms total on a modern phone) and the buffers are shared across all
// modules that need them.
//
// Why pre-generated buffers instead of an AudioWorklet running noise per-sample?
//   - AudioWorklet adds ~200KB of bundle weight + worklet-module loading
//     ceremony, both of which break the iOS user-gesture chain.
//   - 5s of stereo noise = ~1.7MB of RAM. Looped, the seam is imperceptible
//     because subsequent filter modulation (bandpass + LFO) decorrelates
//     consecutive loops.
//   - Per-sample noise via ScriptProcessorNode is deprecated and adds JS
//     overhead on the audio thread.
//
// Stereo decorrelation:
//   Each channel gets an independent random sequence. Even after identical
//   filtering downstream, the two channels diverge enough to create natural
//   stereo width.

const BUFFER_SECONDS = 5  // 5s loops × ~3.5MB total RAM, seamless when filtered

// ── generatePinkNoise ─────────────────────────────────────────────────────
// Paul Kellet's six-tap IIR filter — well-known approximation of 1/f noise
// (equal power per octave). Output level is normalized so peaks stay in
// [-1, 1] without explicit clipping.
function generatePinkNoise(numSamples) {
  const out = new Float32Array(numSamples)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < numSamples; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.96900 * b2 + white * 0.1538520
    b3 = 0.86650 * b3 + white * 0.3104856
    b4 = 0.55000 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.0168980
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
  return out
}

// ── generateBrownNoise ────────────────────────────────────────────────────
// Integrated white noise — 1/f² spectrum, bass-heavy. Leak coefficient (1.02
// divisor) prevents DC drift over long buffers. Output normalized to ~[-1, 1].
function generateBrownNoise(numSamples) {
  const out = new Float32Array(numSamples)
  let prev = 0
  for (let i = 0; i < numSamples; i++) {
    const white = Math.random() * 2 - 1
    prev = (prev + white * 0.02) / 1.02
    out[i] = prev * 3.5  // empirical normalization
  }
  return out
}

// ── createStereoBuffer ────────────────────────────────────────────────────
// Builds a 2-channel AudioBuffer with independent random sequences per channel.
// `generator` is one of generatePinkNoise / generateBrownNoise.
function createStereoBuffer(ctx, generator) {
  const numSamples = Math.floor(ctx.sampleRate * BUFFER_SECONDS)
  const buffer = ctx.createBuffer(2, numSamples, ctx.sampleRate)
  buffer.copyToChannel(generator(numSamples), 0)
  buffer.copyToChannel(generator(numSamples), 1)
  return buffer
}

// ── createNoiseBuffers ────────────────────────────────────────────────────
// Public entry point — generates both buffers and returns them. Cached for
// the life of the AudioContext.
export function createNoiseBuffers(ctx) {
  return {
    pink:  createStereoBuffer(ctx, generatePinkNoise),
    brown: createStereoBuffer(ctx, generateBrownNoise),
  }
}
