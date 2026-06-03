// ── heatGauge ──────────────────────────────────────────────────────────────
// Shared heat-gauge state machine for the tracing games. Pure logic — no
// canvas, no DOM, no refs. The gauge accumulates when the child traces
// faster than the pacing circle and drains when they return to pace. At the
// floor (gauge = 1) the world fully desaturates; recovery brings it back.
//
// Extracted from SquareCanvas/HexagonCanvas, which had drifted apart: Square
// was tuned (faster charge/drain) and gained a "recovered" signal for the
// encouragement system; Hexagon kept the original slower timings. The
// structure was always identical — only the tuning numbers differed. Those
// numbers are now config, so each game preserves its own behavior while
// sharing one implementation.
//
// Usage:
//   const gauge = createHeatGauge({ chargeDelayMs: 500, ... })
//   // per frame, only while the game is "started":
//   const r = gauge.update(dt, { speedRatio, touching })
//   //   r.gauge        : 0..1 raw gauge value
//   //   r.gaugeActive  : true once the floor (1) was reached, until recovery
//   //   r.gaugeEffect  : 0..1 eased effect strength (drives desaturation etc.)
//   //   r.justHitFloor : true on the single frame the floor was reached
//   //   r.justRecovered: true on the single frame recovery completed
//   gauge.reset()  // on game reset
//
// speedRatio = childPathRate / pacingRate. How pacingRate is computed differs
// per game (uniform for Square, per-side for Hexagon), so it's an input here
// rather than a concern of this module.

// Defaults match Square's tuned values (the canonical, most-iterated game).
// Hexagon overrides chargeDelayMs/drainDelayMs/rampUpMs/rampDownMs to preserve
// its current — slower — behavior.
export const GAUGE_DEFAULTS = {
  speedThreshold:   1.2,   // ratio above which the gauge charges
  recoverThreshold: 3.0,   // ratio above which the recovery timer resets (true racing)
  chargeDelayMs:    500,   // sustained too-fast before the gauge starts ramping
  drainDelayMs:     250,   // sustained good-pace before recovery begins (post-floor)
  rampUpMs:         2000,  // gauge 0 → 1 ramp duration
  rampDownMs:       1000,  // gauge 1 → 0 drain duration
  effectThreshold:  0.3,   // gauge value below which no visible effect appears
}

export function createHeatGauge(config = {}) {
  const cfg = { ...GAUGE_DEFAULTS, ...config }

  let heatGauge     = 0
  let tooFastTimer  = 0
  let goodPaceTimer = 0
  let gaugeActive   = false

  function reset() {
    heatGauge     = 0
    tooFastTimer  = 0
    goodPaceTimer = 0
    gaugeActive   = false
  }

  // dt in ms. inputs: { speedRatio, touching }. Call once per frame while the
  // game is started. Returns the frame's gauge state + edge-trigger flags.
  function update(dt, { speedRatio, touching }) {
    const isTooFast  = touching && speedRatio > cfg.speedThreshold
    const isGoodPace = !touching || speedRatio <= cfg.speedThreshold

    // ── Charge timer ──
    if (isTooFast) {
      tooFastTimer = Math.min(cfg.chargeDelayMs, tooFastTimer + dt)
    } else if (isGoodPace && !gaugeActive) {
      // Slowing before floor — slowly decay the charge timer.
      tooFastTimer = Math.max(0, tooFastTimer - dt * 0.5)
    }

    // ── Recovery timer ──
    // Only genuinely racing (> recoverThreshold) resets recovery. Normal
    // variation and moderate over-pace don't block the recovery window.
    const isTrulyRacing = touching && speedRatio > cfg.recoverThreshold
    if (isTrulyRacing) {
      goodPaceTimer = 0
    } else {
      goodPaceTimer = Math.min(cfg.drainDelayMs, goodPaceTimer + dt)
    }

    // ── State transitions ──
    let justHitFloor  = false
    let justRecovered = false

    if (isTooFast && !gaugeActive && tooFastTimer >= cfg.chargeDelayMs) {
      // Charge delay met, still racing — ramp toward the floor.
      heatGauge = Math.min(1, heatGauge + dt / cfg.rampUpMs)
      if (heatGauge >= 1) {
        gaugeActive  = true
        justHitFloor = true   // caller clears the paint canvas
      }
    } else if (isGoodPace && !gaugeActive && heatGauge > 0) {
      // Slowing/lifting before floor — drain back, paint recovers.
      heatGauge = Math.max(0, heatGauge - dt / cfg.rampDownMs)
    } else if (gaugeActive && goodPaceTimer >= cfg.drainDelayMs) {
      // Floor reached; good pace held — drain, only saturation returns.
      heatGauge = Math.max(0, heatGauge - dt / cfg.rampDownMs)
      if (heatGauge <= 0) {
        gaugeActive   = false
        goodPaceTimer = 0
        justRecovered = true   // caller may surface a "that feels better" cue
        // tooFastTimer stays at chargeDelayMs — re-racing re-triggers immediately
      }
    }

    heatGauge = Math.max(0, Math.min(1, heatGauge))

    // ── Eased effect ──
    // Below the threshold: no effect. Above: quadratic ease-in so the onset
    // is gentle. Drives desaturation, paint fade, etc. in the caller.
    const gFx = heatGauge < cfg.effectThreshold
      ? 0
      : Math.pow((heatGauge - cfg.effectThreshold) / (1 - cfg.effectThreshold), 2)

    return {
      gauge:        heatGauge,
      gaugeActive,
      gaugeEffect:  gFx,
      justHitFloor,
      justRecovered,
    }
  }

  return { update, reset }
}
