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
//   The texture windows are shifted ~1.5 s earlier than the breathe-in /
//   breathe-out *sides* so that each texture begins ramping at the corner
//   the pacing circle traverses *entering* the side, not at the start of
//   the straight. Each window still spans 4 s (0.25 of the cycle) — it
//   just covers entry-corner + straight rather than straight + exit-corner.
//
//   Inhale window: [INHALE_START, INHALE_END) wrapped — bottom-left corner
//     (entering breathe-in straight from left hold) → entry to bottom-right
//     corner (exit toward right hold). At game start (breathPhase = 0) the
//     pacing is partway through the breathe-in straight; the inhale bell
//     is already ~93% of peak, so the texture is audible immediately.
//   Hold (top, right side): SILENT.
//   Exhale window: [EXHALE_START, EXHALE_END) — top-right corner (entering
//     breathe-out straight from right hold) → entry to top-left corner.
//   Hold (bottom, left side): SILENT.
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

// ── Phase windows ────────────────────────────────────────────────────────
// Derived from the SquareCanvas pacing geometry. The canvas uses corner
// radius r = sq * 0.22, which makes each side ~62% straight + ~38% arc.
// CORNER_FRAC_OF_CYCLE is the breathPhase length of one arc (~0.0954, or
// ~1.53 s of the 16 s cycle). Each texture window starts that long BEFORE
// its respective breathe-in/breathe-out side begins, so the bell starts
// ramping while the pacing circle is in the entry-corner.
//
// If SquareCanvas's radius ratio ever changes, update SQUARE_RADIUS_RATIO
// here to match — these are physically coupled.
const SQUARE_RADIUS_RATIO  = 0.22
const STRAIGHT_FRAC        = (1 - 2 * SQUARE_RADIUS_RATIO) /
                              ((1 - 2 * SQUARE_RADIUS_RATIO) + Math.PI * SQUARE_RADIUS_RATIO / 2)
const CORNER_FRAC_OF_CYCLE = (1 - STRAIGHT_FRAC) / 4

// Fine-tuning knob: shift both windows later by this many seconds (positive
// values delay the texture onset; negative values pull it earlier). Useful
// for nudging the perceptual timing without changing the structural shape.
// 16-second cycle → 1 s = 0.0625 of breathPhase.
const WINDOW_DELAY_SECONDS = 0.2
const WINDOW_DELAY_FRAC    = WINDOW_DELAY_SECONDS / 16

// Inhale wraps around 1.0: starts at ~0.9109, ends at ~0.1609.
const INHALE_START = 1   - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
const INHALE_END   = 0.25 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
// Exhale offset by half a cycle.
const EXHALE_START = 0.5 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
const EXHALE_END   = 0.75 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC

// setTargetAtTime time constant for envelope tracking. Small (≈30 ms) because
// the input breathPhase is already smooth; we just need to avoid zipper.
const TC_ENV = 0.03

// Change-throttle epsilon — skip re-scheduling when target moves less than this.
const RESCHEDULE_EPS = 0.002

// ── computeBellEnvelope ──────────────────────────────────────────────────
// sin(π·t) bell over a normalized window. Wrap-aware: when windowStart
// > windowEnd the window straddles breathPhase = 1.0 (e.g., inhale runs
// from 0.9046 through 1.0 and back to 0.1546). Zero outside the window.
function computeBellEnvelope(breathPhase, windowStart, windowEnd) {
  // Window length, accounting for wrap. (a + 1) % 1 normalizes a negative
  // delta into [0, 1); when windowEnd > windowStart this is just the
  // straight difference.
  const length = ((windowEnd - windowStart) + 1) % 1
  if (length === 0) return 0
  const offset = ((breathPhase - windowStart) + 1) % 1
  if (offset >= length) return 0
  return Math.sin((offset / length) * Math.PI)
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
