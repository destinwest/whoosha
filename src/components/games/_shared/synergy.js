// ── synergy ────────────────────────────────────────────────────────────────
// Shared synergy-reward accumulator + stage mapping for the tracing games.
// Pure logic — no canvas, no DOM, no refs. An on-pace accumulator grows while
// the child stays close to the pacing circle and in pace, and decays when
// they drift. The accumulator maps to a continuous stage (0.0 → 4.0) that the
// canvas reads to drive visuals (amber growth, ember particles) and the audio
// director reads to drive the synergy bowl.
//
// Identical between Square and Hexagon (no drift), so the timings are shared
// defaults — but still expressed as config so a future game can differ.
//
// Usage:
//   const synergy = createSynergy()                  // or createSynergy({ ... })
//   const stage = synergy.update(dt, {
//     touching, gaugeActive, canEvaluate, close, inPace,
//   })
//   synergy.reset()
//
// The caller computes `close` (child within lw·threshold of pacing) and
// `inPace` (speedRatio ≤ threshold) and `canEvaluate` (started + pacing pos +
// child pos all present) because those involve game-specific geometry and
// pacing-rate math. This module only owns the accumulator and stage curve.

export const SYNERGY_DEFAULTS = {
  // durations (ms) for stages 0→1, 1→2, 2→3, 3→4
  stageTimesMs: [4000, 4000, 8000, 16000],
  // full drain duration from max accumulation when the finger lifts or the
  // heat-gauge floor engages
  returnMs:     3000,
}

export function createSynergy(config = {}) {
  const cfg = { ...SYNERGY_DEFAULTS, ...config }
  const [t01, t12, t23, t34] = cfg.stageTimesMs
  const maxAccum   = t01 + t12 + t23 + t34
  const returnRate = maxAccum / cfg.returnMs   // accum-ms drained per real-ms during return

  // Cumulative thresholds for the piecewise-linear stage curve.
  const c1 = t01
  const c2 = c1 + t12
  const c3 = c2 + t23
  const c4 = c3 + t34   // === maxAccum

  let accum = 0

  function reset() {
    accum = 0
  }

  // dt in ms. Returns the continuous synergy stage (0.0 .. 4.0).
  // Behaviors (exactly as the original inline block):
  //   - finger lifted OR gauge-floor active → fast return toward 0 at returnRate
  //   - touching + evaluable + close + in-pace → accumulator grows at +dt
  //   - touching + evaluable + drifting        → symmetric 1:1 slow decay
  //   - touching but not yet evaluable          → accumulator unchanged
  function update(dt, { touching, gaugeActive, canEvaluate, close, inPace }) {
    if (!touching || gaugeActive) {
      accum = Math.max(0, accum - dt * returnRate)
    } else if (canEvaluate) {
      if (close && inPace) {
        accum = Math.min(maxAccum, accum + dt)
      } else {
        accum = Math.max(0, accum - dt)
      }
    }

    // Map accumulator → continuous stage (piecewise linear).
    const a = accum
    if      (a >= c4) return 4
    else if (a >= c3) return 3 + (a - c3) / t34
    else if (a >= c2) return 2 + (a - c2) / t23
    else if (a >= c1) return 1 + (a - c1) / t12
    else              return a / t01
  }

  return { update, reset }
}
