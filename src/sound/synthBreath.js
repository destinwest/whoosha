// ── synthBreath ────────────────────────────────────────────────────────────
// Breath-coupled abstract ambient — the foundation sound of the regulated
// state. Replaces the failed nature-mimicry approach (stream/breeze/leaves)
// with three intentionally-musical elements that breathe with the pacing
// circle of the Square game.
//
// Design philosophy:
//   This is not "outdoors." It's intentional sonic art — closer in spirit
//   to Brian Eno, Stars of the Lid, Hiroshi Yoshimura. Because it's
//   unambiguously synthesized, the brain doesn't try to match it against
//   memories of real environments; it's accepted as musical underscoring.
//   This is what makes pure synthesis work for meditative content.
//
// Elements:
//   1. Drone bed     — three sine partials in just intonation (A2 + E3 + A3,
//                       slight detune for natural beating). Always on, very
//                       quiet. Provides the tonal center / "musical ground."
//   2. Inhale texture — bright airy filtered noise (bandpass ~1500 Hz) that
//                       swells in over the 4-second inhale window via a
//                       sin(π·t) bell envelope. Returns to silence at hold.
//                       Carries upward, rising energy.
//   3. Exhale texture — warm dark filtered noise (bandpass ~380 Hz) that
//                       swells in over the 4-second exhale window via the
//                       same bell envelope. Carries downward, releasing
//                       energy.
//
// Mapping to the Square breathPhase 0–1 cycle:
//   [0.00, 0.25)  inhale  → inhale texture swells, exhale silent
//   [0.25, 0.50)  hold    → both textures silent, drone only
//   [0.50, 0.75)  exhale  → exhale texture swells, inhale silent
//   [0.75, 1.00)  hold    → both textures silent, drone only
//
// Why bell envelopes (sin·π·t) and not linear ramps?
//   The sine half-cycle has zero derivative at both ends — no click at the
//   silence-to-swell or swell-to-silence transitions, and the perceptual
//   shape feels "breath-like" (gradual onset, lingering middle, gradual
//   fade). Linear ramps would corner-pop at start/end.

// ── Tuning ────────────────────────────────────────────────────────────────
// Drone — A2 voicing chosen because:
//   - A2 (110 Hz) is below phone-speaker reproduction; perceived as bass
//     through its second harmonic. Adds "weight" without being heard as a tone.
//   - E3 (164.81, 3:2) and A3 (220, 2:1) are well-reproduced and audible.
//   - Open-fifth voicing (no third) is neither major nor minor; ambient genre
//     standard. Avoids emotional valence.
const DRONE_PARTIALS = [
  { hz: 110.00,  detune: 0,    gain: 0.045 },  // A2 fundamental — felt
  { hz: 164.81,  detune: +3,   gain: 0.038 },  // E3 fifth, +3 cents — slow beating
  { hz: 220.00,  detune: -2,   gain: 0.030 },  // A3 octave, -2 cents
]

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

  // ── Drone ──
  // All partials sum into a single droneGain so the drone level can be
  // attenuated as a group later if needed (e.g., a future "deepen" feature).
  const droneGain = ctx.createGain()
  droneGain.gain.value = 1
  droneGain.connect(output)

  const droneOscs = DRONE_PARTIALS.map(({ hz, detune, gain }) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = hz
    osc.detune.value = detune
    const g = ctx.createGain()
    g.gain.value = gain
    osc.connect(g).connect(droneGain)
    osc.start(ctx.currentTime + Math.random() * 0.3)
    return osc
  })

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
    droneOscs.forEach((o) => { try { o.stop() } catch (e) {} })
    try { inhaleSource.stop() } catch (e) {}
    try { exhaleSource.stop() } catch (e) {}
    try { output.disconnect() } catch (e) {}
  }

  return { output, update, dispose }
}
