// ── synthBowl ──────────────────────────────────────────────────────────────
// Crystal singing-bowl-like drone — four sine partials tuned in near-just-
// intonation around C3 (130.81 Hz). The slight detunings (a few hundredths
// of a Hz off perfect ratios) produce slow beating between partials, which
// is the perceptual signature of real bowls.
//
// Partials fade in independently based on the synergy stage (0–4) so the
// reward builds gradually as the child stays in flow:
//   stage 0 → 1: fundamental appears
//   stage 1 → 2: perfect fifth joins
//   stage 2 → 3: octave joins
//   stage 3 → 4: high shimmer joins
//
// Why oscillators rather than samples?
//   - Parametric control over the swell shape (essential for additive
//     fade-in over the ambient bed)
//   - Zero asset weight
//   - Just-intonation ratios are exact (no recording compromises)
//   - Loop-free by definition

const FUND_HZ        = 130.81           // C3
const FIFTH_HZ       = 130.81 * 1.4985  // ~3:2, slightly flat for ~0.2 Hz beating
const OCTAVE_HZ      = 130.81 * 1.9991  // ~2:1, slightly flat
const SHIMMER_HZ     = 130.81 * 7.992   // ~8:1 (C6 region), enough detune for ~1.5 Hz shimmer

const FUND_PEAK      = 0.50
const FIFTH_PEAK     = 0.35
const OCTAVE_PEAK    = 0.25
const SHIMMER_PEAK   = 0.08

// setTargetAtTime time constants for per-partial fade — matches the plan's
// 300 / 400 / 500 / 800 ms ramps in linear-ramp terms (tc ≈ ramp_ms / 3.5).
const TC_FUND     = 0.09
const TC_FIFTH    = 0.11
const TC_OCTAVE   = 0.14
const TC_SHIMMER  = 0.23

const RESCHEDULE_EPS = 0.002

// ── makePartial ────────────────────────────────────────────────────────────
// Builds one partial: sine oscillator + its own gain envelope. Optional
// triangle blend (used only on the fundamental for a touch of harmonic warmth).
function makePartial(ctx, freqHz, includeTriangle = false) {
  const gain = ctx.createGain()
  gain.gain.value = 0

  const sine = ctx.createOscillator()
  sine.type = 'sine'
  sine.frequency.value = freqHz
  sine.connect(gain)
  sine.start(ctx.currentTime + Math.random() * 0.5)

  if (includeTriangle) {
    // A faint triangle at the same pitch adds odd-harmonic warmth without
    // harshness. Triangle peak amplitude is 25% of the sine.
    const tri = ctx.createOscillator()
    tri.type = 'triangle'
    tri.frequency.value = freqHz
    const triGain = ctx.createGain()
    triGain.gain.value = 0.25
    tri.connect(triGain).connect(gain)
    tri.start(ctx.currentTime + Math.random() * 0.5)
    return { gain, oscs: [sine, tri] }
  }
  return { gain, oscs: [sine] }
}

export function createBowl(ctx) {
  const output = ctx.createGain()
  output.gain.value = 1

  const fund    = makePartial(ctx, FUND_HZ,    true)   // fundamental gets triangle blend
  const fifth   = makePartial(ctx, FIFTH_HZ)
  const octave  = makePartial(ctx, OCTAVE_HZ)
  const shimmer = makePartial(ctx, SHIMMER_HZ)

  fund.gain.connect(output)
  fifth.gain.connect(output)
  octave.gain.connect(output)
  shimmer.gain.connect(output)

  let lastFund = 0, lastFifth = 0, lastOctave = 0, lastShimmer = 0

  // ── setStage ─────────────────────────────────────────────────────────────
  // stage in [0, 4]. Each partial fades in linearly across its stage interval.
  // Called by the director per-frame; change-throttled to avoid noise.
  function setStage(stage) {
    const now = ctx.currentTime
    const fundT    = Math.min(1, Math.max(0, stage))                              // 0..1 across stage 0→1
    const fifthT   = Math.min(1, Math.max(0, stage - 1))                          // 0..1 across stage 1→2
    const octaveT  = Math.min(1, Math.max(0, stage - 2))                          // 0..1 across stage 2→3
    const shimmerT = Math.min(1, Math.max(0, stage - 3))                          // 0..1 across stage 3→4

    const fundTarget    = FUND_PEAK    * fundT
    const fifthTarget   = FIFTH_PEAK   * fifthT
    const octaveTarget  = OCTAVE_PEAK  * octaveT
    const shimmerTarget = SHIMMER_PEAK * shimmerT

    if (Math.abs(fundTarget    - lastFund)    > RESCHEDULE_EPS) {
      fund.gain.gain.setTargetAtTime(fundTarget, now, TC_FUND)
      lastFund = fundTarget
    }
    if (Math.abs(fifthTarget   - lastFifth)   > RESCHEDULE_EPS) {
      fifth.gain.gain.setTargetAtTime(fifthTarget, now, TC_FIFTH)
      lastFifth = fifthTarget
    }
    if (Math.abs(octaveTarget  - lastOctave)  > RESCHEDULE_EPS) {
      octave.gain.gain.setTargetAtTime(octaveTarget, now, TC_OCTAVE)
      lastOctave = octaveTarget
    }
    if (Math.abs(shimmerTarget - lastShimmer) > RESCHEDULE_EPS) {
      shimmer.gain.gain.setTargetAtTime(shimmerTarget, now, TC_SHIMMER)
      lastShimmer = shimmerTarget
    }
  }

  // ── dispose ──
  function dispose() {
    ;[fund, fifth, octave, shimmer].forEach(({ oscs, gain }) => {
      oscs.forEach((o) => { try { o.stop() } catch (e) {} })
      try { gain.disconnect() } catch (e) {}
    })
    try { output.disconnect() } catch (e) {}
  }

  return { output, setStage, dispose }
}
