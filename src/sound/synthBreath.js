// ── synthBreath ────────────────────────────────────────────────────────────
// Breath-coupled abstract ambient — two filtered-noise textures that swell
// in and out within their respective phases of the Square breath cycle.
//
// The previous version of this module included a continuous three-partial
// sine drone underneath the textures. The client identified that drone as
// creating a sense of "underlying dread" — sustained low harmonic drones
// carry strong cultural associations with cinematic tension. The drone has
// been removed; this module is now diagnostic, isolating whether the
// inhale and exhale textures stand on their own.
//
// Elements:
//   1. Inhale texture — bright airy filtered noise (bandpass ~1500 Hz) that
//                       swells in over the 4-second inhale window via a
//                       sin(π·t) bell envelope. Returns to silence at hold.
//                       Carries upward, rising energy.
//   2. Exhale texture — warm dark filtered noise (bandpass ~380 Hz) that
//                       swells in over the 4-second exhale window via the
//                       same bell envelope. Carries downward, releasing
//                       energy.
//
// Mapping to the Square breathPhase 0–1 cycle:
//   [0.00, 0.25)  inhale  → inhale texture swells, exhale silent
//   [0.25, 0.50)  hold    → SILENT
//   [0.50, 0.75)  exhale  → exhale texture swells, inhale silent
//   [0.75, 1.00)  hold    → SILENT
//
// Why bell envelopes (sin·π·t) and not linear ramps?
//   The sine half-cycle has zero derivative at both ends — no click at the
//   silence-to-swell or swell-to-silence transitions, and the perceptual
//   shape feels "breath-like" (gradual onset, lingering middle, gradual
//   fade). Linear ramps would corner-pop at start/end.

// ── Tuning ────────────────────────────────────────────────────────────────

// Inhale texture — bright, airy
const INHALE_FILTER_HZ   = 1500
const INHALE_FILTER_Q    = 0.55
const INHALE_PEAK_GAIN   = 0.13

// Exhale texture — warm, low
const EXHALE_FILTER_HZ   = 380
const EXHALE_FILTER_Q    = 0.55
const EXHALE_PEAK_GAIN   = 0.13

// Phase windows (within breathPhase 0–1)
const INHALE_START = 0.00
const INHALE_END   = 0.25
const EXHALE_START = 0.50
const EXHALE_END   = 0.75

// setTargetAtTime time constant for envelope tracking. Small (≈30 ms) because
// the input breathPhase is already smooth; we just need to avoid zipper.
const TC_ENV = 0.03

// Change-throttle epsilon — skip re-scheduling when target moves less than this.
const RESCHEDULE_EPS = 0.002

// ── computeEnvelope ──────────────────────────────────────────────────────
// sin(π·t) bell over a normalized window. Zero outside the window.
function computeBellEnvelope(breathPhase, windowStart, windowEnd) {
  if (breathPhase < windowStart || breathPhase >= windowEnd) return 0
  const t = (breathPhase - windowStart) / (windowEnd - windowStart)
  return Math.sin(t * Math.PI)
}

export function createBreath(ctx, pinkBuffer) {
  // ── Output trunk ──
  const output = ctx.createGain()
  output.gain.value = 1

  // ── Inhale texture ──
  // Pink noise → bandpass → envelope gain. Source loops forever; the
  // envelope gates audibility to the inhale window only.
  const inhaleSource = ctx.createBufferSource()
  inhaleSource.buffer = pinkBuffer
  inhaleSource.loop = true
  inhaleSource.start(0, Math.random() * pinkBuffer.duration)

  const inhaleFilter = ctx.createBiquadFilter()
  inhaleFilter.type = 'bandpass'
  inhaleFilter.frequency.value = INHALE_FILTER_HZ
  inhaleFilter.Q.value = INHALE_FILTER_Q

  const inhaleEnv = ctx.createGain()
  inhaleEnv.gain.value = 0
  inhaleSource.connect(inhaleFilter).connect(inhaleEnv).connect(output)

  // ── Exhale texture ──
  const exhaleSource = ctx.createBufferSource()
  exhaleSource.buffer = pinkBuffer
  exhaleSource.loop = true
  exhaleSource.start(0, Math.random() * pinkBuffer.duration)

  const exhaleFilter = ctx.createBiquadFilter()
  exhaleFilter.type = 'bandpass'
  exhaleFilter.frequency.value = EXHALE_FILTER_HZ
  exhaleFilter.Q.value = EXHALE_FILTER_Q

  const exhaleEnv = ctx.createGain()
  exhaleEnv.gain.value = 0
  exhaleSource.connect(exhaleFilter).connect(exhaleEnv).connect(output)

  // Change-throttle state for update().
  let lastInhale = 0
  let lastExhale = 0

  // ── update ────────────────────────────────────────────────────────────
  // Called per-frame by the director with breathPhase ∈ [0, 1].
  // Updates the inhale and exhale envelope gains via setTargetAtTime so
  // they smoothly follow the breath cycle without zipper noise.
  function update(breathPhase) {
    const now = ctx.currentTime

    const inhaleTarget = INHALE_PEAK_GAIN * computeBellEnvelope(breathPhase, INHALE_START, INHALE_END)
    if (Math.abs(inhaleTarget - lastInhale) > RESCHEDULE_EPS) {
      inhaleEnv.gain.setTargetAtTime(inhaleTarget, now, TC_ENV)
      lastInhale = inhaleTarget
    }

    const exhaleTarget = EXHALE_PEAK_GAIN * computeBellEnvelope(breathPhase, EXHALE_START, EXHALE_END)
    if (Math.abs(exhaleTarget - lastExhale) > RESCHEDULE_EPS) {
      exhaleEnv.gain.setTargetAtTime(exhaleTarget, now, TC_ENV)
      lastExhale = exhaleTarget
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────
  function dispose() {
    try { inhaleSource.stop() } catch (e) {}
    try { exhaleSource.stop() } catch (e) {}
    try { output.disconnect() } catch (e) {}
  }

  return { output, update, dispose }
}
