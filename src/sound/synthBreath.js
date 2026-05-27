// ── synthBreath ──────────────────────────────────────────────────────────
// Breath-coupled textures that swell during the inhale and exhale phases
// of the Square breath cycle. Two filtered-noise paths (one per phase),
// each gated by a sin(π·t) bell envelope. Holds are silent.
//
// ── Prototype mode selector ──
// Modes A, B, D introduce a SWEEPING resonance: the formant frequency
// rises linearly across the inhale window and falls across the exhale
// window, matching the rising/falling energy of the physical breath.
// Mode C is kept as the prior static-resonance reference.
//
//   'wave' — original baseline. Pink noise through a single stationary
//            bandpass. Reads as "ocean wave." Kept for reference.
//   'A'    — Subtle sweep. Inhale resonance rises 700 → 850 Hz across
//            its window; exhale falls 850 → 700 Hz. Residual LFO retained
//            for organic motion on top. The pitch change reads more as
//            "rising warmth" than as an obvious pitch glide.
//   'B'    — Moderate sweep. Inhale 600 → 1000 Hz; exhale 1000 → 600 Hz.
//            Pitch motion clearly perceivable; LFO reduced so the sweep
//            is the dominant motion.
//   'C'    — Static reference (unchanged from prior iteration). Warm
//            "haa" character with inhale resonance at 780 Hz, exhale at
//            700 Hz. No sweep across the window.
//   'D'    — Obvious sweep. Inhale 500 → 1500 Hz; exhale 1500 → 500 Hz.
//            Dramatic, unmistakable pitch glide. LFO disabled — the
//            sweep provides all the motion.
//   'sibilant' — Original "Sibilant Highpass" preset, restored for A/B
//            comparison against the sweep variants. Asymmetric in/out
//            character: bright sibilant inhale (highpass 2 kHz, resonance
//            ~2.8 kHz, airy "shh") + warm exhale (highpass 200 Hz,
//            resonance ~700 Hz, soft "haa"). Static resonance with slow
//            LFO; no sweep within the window.
//
// Sweep variants linearly interpolate resStartHz → resEndHz across the
// bell-progress timeline. The static highpass and amplitude bell envelope
// are unchanged across all modes. Holds remain silent.

const BREATH_MODE = 'sibilant'  // 'wave' | 'A' | 'B' | 'C' | 'D' | 'sibilant'

// ── Per-mode tunables ─────────────────────────────────────────────────────
// peakGain is the bell-envelope peak amplitude (linear gain). The bell
// goes from 0 to peakGain to 0 over the texture window.
const MODE_PARAMS = {
  // Baseline — what we had before this prototype work.
  wave: {
    inhale: { bandpassHz: 1500, q: 0.55, peakGain: 0.13 },
    exhale: { bandpassHz: 380,  q: 0.55, peakGain: 0.13 },
  },

  // Static-resonance params (used by mode C only):
  //   highpassHz : floor frequency (everything below is cut)
  //   hpQ        : highpass resonance (higher = sharper rolloff)
  //   resHz      : resonance peak frequency (the "formant"); fixed across window
  //   resQ       : resonance sharpness (higher = narrower, more vocal)
  //   resLFOHz   : LFO rate modulating the resonance center
  //   resLFODepth: depth of resonance modulation as a fraction of resHz
  //   peakGain   : bell envelope peak amplitude
  //
  // Sweep-resonance params (used by modes A, B, D):
  //   resStartHz : resonance freq at start of bell window
  //   resEndHz   : resonance freq at end of bell window
  //     For inhale: resStartHz < resEndHz (rising). For exhale: > (falling).
  //   Other fields same as above; LFO depth/rate optional (0 disables).

  // A — Subtle sweep (small range, light LFO).
  A: {
    inhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 700, resEndHz: 850, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.10, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 850, resEndHz: 700, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.10, peakGain: 0.20 },
  },

  // B — Moderate sweep (medium range, minimal LFO).
  B: {
    inhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 600, resEndHz: 1000, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.05, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 1000, resEndHz: 600, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.05, peakGain: 0.20 },
  },

  // C — Static reference (kept from prior iteration; uses buildChain_A).
  C: {
    inhale: { highpassHz: 200, hpQ: 0.7, resHz: 780, resQ: 3.5, resLFOHz: 0.11, resLFODepth: 0.20, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
  },

  // D — Obvious sweep (large range, LFO disabled — sweep does all the work).
  D: {
    inhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 500, resEndHz: 1500, resQ: 3.5, resLFOHz: 0, resLFODepth: 0, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resStartHz: 1500, resEndHz: 500, resQ: 3.5, resLFOHz: 0, resLFODepth: 0, peakGain: 0.20 },
  },

  // 'sibilant' — Original "Sibilant Highpass" preset, restored for A/B
  // comparison against the sweep variants. Asymmetric in/out character:
  //   inhale  highpass 2 kHz, resonance peaked at ~2.8 kHz (airy "shh")
  //   exhale  highpass 200 Hz, resonance peaked at ~700 Hz (warm "haa")
  // No frequency sweep within the window. Slow LFO on resonance center
  // (depth 18–20% of resHz). Uses buildChain_A (static-resonance chain).
  sibilant: {
    inhale: { highpassHz: 2000, hpQ: 0.7, resHz: 2800, resQ: 3.5, resLFOHz: 0.13, resLFODepth: 0.18, peakGain: 0.20 },
    exhale: { highpassHz: 200,  hpQ: 0.7, resHz: 700,  resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
  },
}

// ── Geometry-derived window timing (unchanged) ───────────────────────────
// Pacing path: corner radius r = sq * 0.22; each side is ~62% straight +
// ~38% arc. Windows start at the entry-corner of the breathe-in/-out side.
const SQUARE_RADIUS_RATIO  = 0.22
const STRAIGHT_FRAC        = (1 - 2 * SQUARE_RADIUS_RATIO) /
                              ((1 - 2 * SQUARE_RADIUS_RATIO) + Math.PI * SQUARE_RADIUS_RATIO / 2)
const CORNER_FRAC_OF_CYCLE = (1 - STRAIGHT_FRAC) / 4

// Fine-tuning knob: shift both windows later by this many seconds.
const WINDOW_DELAY_SECONDS = 0.6
const WINDOW_DELAY_FRAC    = WINDOW_DELAY_SECONDS / 16

const INHALE_START = 1   - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
const INHALE_END   = 0.25 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
const EXHALE_START = 0.5 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC
const EXHALE_END   = 0.75 - CORNER_FRAC_OF_CYCLE + WINDOW_DELAY_FRAC

const TC_ENV         = 0.03
const RESCHEDULE_EPS = 0.002

// Envelope shape — where the bell reaches its peak within the window
// (0..1). 0.5 = symmetric sine bell (original behavior). Values below 0.5
// shift the peak earlier, giving a faster rise and a longer/gentler fall
// — mimics how a real breath trails off softly at its end. 0.4 means the
// rise occupies the first 40% of the window (~1.6 s of the 4 s phase) and
// the decay stretches across the remaining 60% (~2.4 s).
const ENVELOPE_PEAK_AT = 0.4

// ── Helpers ───────────────────────────────────────────────────────────────

// Wrap-aware bell progress. Returns t ∈ [0, 1) within the window, or null
// if breathPhase is outside it.
function computeBellProgress(breathPhase, windowStart, windowEnd) {
  const length = ((windowEnd - windowStart) + 1) % 1
  if (length === 0) return null
  const offset = ((breathPhase - windowStart) + 1) % 1
  if (offset >= length) return null
  return offset / length
}

// Asymmetric bell envelope. Returns a value in [0, 1] for progress ∈ [0, 1],
// with the peak (= 1) occurring at progress = peakAt rather than at 0.5.
// Both halves use sin(x · π/2) so the curve is smooth and reaches the peak
// with zero derivative from each side — no kink at the top. When peakAt = 0.5
// this reduces to the symmetric sin(π·t) bell.
function evaluateAsymmetricBell(progress, peakAt) {
  if (progress < peakAt) {
    return Math.sin((progress / peakAt) * (Math.PI / 2))
  }
  return Math.sin(((1 - progress) / (1 - peakAt)) * (Math.PI / 2))
}

function makeSource(ctx, buffer) {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.start(0, Math.random() * buffer.duration)
  return source
}

// ── Chain builders ───────────────────────────────────────────────────────
// Each builder returns:
//   output   — last node in the chain; gets connected to the outer mix
//   envGain  — GainNode whose .gain is driven by the bell envelope
//   onProgress(progress, now) — optional, called per-frame with progress
//                                (0..1 within window, or null when outside)
//   dispose()

function buildChain_wave(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = params.bandpassHz
  bp.Q.value = params.q

  const envGain = ctx.createGain()
  envGain.gain.value = 0
  source.connect(bp).connect(envGain)

  return {
    output: envGain,
    envGain,
    dispose() { try { source.stop() } catch (e) {} },
  }
}

function buildChain_A(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = params.highpassHz
  hp.Q.value = params.hpQ

  const res = ctx.createBiquadFilter()
  res.type = 'bandpass'
  res.frequency.value = params.resHz
  res.Q.value = params.resQ

  // Slow LFO on resonance center for "breathing brightness."
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = params.resLFOHz
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = params.resHz * params.resLFODepth
  lfo.connect(lfoDepth).connect(res.frequency)
  lfo.start(ctx.currentTime + Math.random() * 2)

  const envGain = ctx.createGain()
  envGain.gain.value = 0
  source.connect(hp).connect(res).connect(envGain)

  return {
    output: envGain,
    envGain,
    dispose() {
      try { source.stop() } catch (e) {}
      try { lfo.stop()    } catch (e) {}
    },
  }
}

// Same structure as buildChain_A, but the resonance frequency is swept
// from params.resStartHz to params.resEndHz linearly across the bell-
// progress timeline. Inhale specifies a rising sweep (start < end);
// exhale specifies a falling sweep (start > end). The LFO (if depth > 0)
// adds residual wobble on top of the swept base frequency.
function buildChain_sweep(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = params.highpassHz
  hp.Q.value = params.hpQ

  const res = ctx.createBiquadFilter()
  res.type = 'bandpass'
  res.frequency.value = params.resStartHz
  res.Q.value = params.resQ

  // Optional residual LFO on the resonance center. Sums with the swept
  // base value (Web Audio adds connected signals to AudioParam values).
  let lfo = null
  if (params.resLFOHz > 0 && params.resLFODepth > 0) {
    lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = params.resLFOHz
    const lfoDepth = ctx.createGain()
    const midHz = (params.resStartHz + params.resEndHz) / 2
    lfoDepth.gain.value = midHz * params.resLFODepth
    lfo.connect(lfoDepth).connect(res.frequency)
    lfo.start(ctx.currentTime + Math.random() * 2)
  }

  const envGain = ctx.createGain()
  envGain.gain.value = 0
  source.connect(hp).connect(res).connect(envGain)

  let lastResHz = params.resStartHz

  return {
    output: envGain,
    envGain,
    // Linear sweep from resStartHz to resEndHz across the bell window.
    // setTargetAtTime smooths frame-to-frame writes (TC ~50ms).
    onProgress(progress, now) {
      if (progress === null) return
      const targetHz = params.resStartHz + (params.resEndHz - params.resStartHz) * progress
      if (Math.abs(targetHz - lastResHz) > 1) {
        res.frequency.setTargetAtTime(targetHz, now, 0.05)
        lastResHz = targetHz
      }
    },
    dispose() {
      try { source.stop() } catch (e) {}
      if (lfo) try { lfo.stop() } catch (e) {}
    },
  }
}

// A / B / D use the sweep builder; C and 'sibilant' use the static-resonance builder.
const CHAIN_BUILDERS = {
  wave:     buildChain_wave,
  A:        buildChain_sweep,
  B:        buildChain_sweep,
  C:        buildChain_A,
  D:        buildChain_sweep,
  sibilant: buildChain_A,
}

// ── createBreath ─────────────────────────────────────────────────────────
export function createBreath(ctx, pinkBuffer) {
  const params  = MODE_PARAMS[BREATH_MODE]
  const builder = CHAIN_BUILDERS[BREATH_MODE]
  if (!params || !builder) {
    throw new Error(`synthBreath: unknown BREATH_MODE "${BREATH_MODE}"`)
  }

  // Outer gain — what SoundDirector's dysregulation ducker writes to.
  const output = ctx.createGain()
  output.gain.value = 1

  const inhaleChain = builder(ctx, pinkBuffer, params.inhale, true)
  const exhaleChain = builder(ctx, pinkBuffer, params.exhale, false)
  inhaleChain.output.connect(output)
  exhaleChain.output.connect(output)

  let lastInhaleGain = 0
  let lastExhaleGain = 0

  function update(breathPhase) {
    const now = ctx.currentTime

    const ip = computeBellProgress(breathPhase, INHALE_START, INHALE_END)
    const ig = (ip === null ? 0 : evaluateAsymmetricBell(ip, ENVELOPE_PEAK_AT)) * params.inhale.peakGain
    if (Math.abs(ig - lastInhaleGain) > RESCHEDULE_EPS) {
      inhaleChain.envGain.gain.setTargetAtTime(ig, now, TC_ENV)
      lastInhaleGain = ig
    }
    inhaleChain.onProgress?.(ip, now)

    const xp = computeBellProgress(breathPhase, EXHALE_START, EXHALE_END)
    const xg = (xp === null ? 0 : evaluateAsymmetricBell(xp, ENVELOPE_PEAK_AT)) * params.exhale.peakGain
    if (Math.abs(xg - lastExhaleGain) > RESCHEDULE_EPS) {
      exhaleChain.envGain.gain.setTargetAtTime(xg, now, TC_ENV)
      lastExhaleGain = xg
    }
    exhaleChain.onProgress?.(xp, now)
  }

  function dispose() {
    inhaleChain.dispose()
    exhaleChain.dispose()
    try { output.disconnect() } catch (e) {}
  }

  return { output, update, dispose }
}
