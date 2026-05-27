// ── synthBreath ──────────────────────────────────────────────────────────
// Breath-coupled textures that swell during the inhale and exhale phases
// of the Square breath cycle. Two filtered-noise paths (one per phase),
// each gated by a sin(π·t) bell envelope. Holds are silent.
//
// ── Prototype mode selector ──
// All non-baseline modes use the same DSP chain (highpass + resonant
// bandpass + slow LFO on the resonance center — the structure of mode A).
// A's exhale character ("haa", warm, lowish resonance) was identified as
// the strong direction. Modes B / C / D are subtle parameter variations
// on that exhale shape, applied to BOTH inhale and exhale, to test
// different ways of treating the inhale phase.
//
//   'wave' — original baseline. Pink noise through a single stationary
//            bandpass. Reads as "ocean wave." Kept for reference.
//   'A'    — Sibilant Highpass. Inhale highpass=2 kHz with resonance at
//            ~2.8 kHz (airy "shh"); exhale highpass=200 Hz with resonance
//            at ~700 Hz (warm "haa"). The exhale character was identified
//            as the right direction; modes B/C/D explore it.
//   'B'    — A's exhale APPLIED VERBATIM TO BOTH PHASES. Tests whether
//            the bell-envelope timing alone provides enough in/out
//            structure when the texture itself is identical.
//   'C'    — A's exhale, with the inhale's resonance shifted up a touch
//            (700 → 780 Hz) and a slightly faster resonance-LFO. Same
//            warm character with a small pitch differentiation between
//            in and out.
//   'D'    — A's exhale, with more LFO movement on the resonance center
//            (faster rate, deeper modulation) for both phases. More
//            "alive" / animated feel.
//
// All modes share window timing, the bell envelope, and the dysregulation
// ducking via the outer output gain (driven by SoundDirector).

const BREATH_MODE = 'B'  // 'wave' | 'A' | 'B' | 'C' | 'D'

// ── Per-mode tunables ─────────────────────────────────────────────────────
// peakGain is the bell-envelope peak amplitude (linear gain). The bell
// goes from 0 to peakGain to 0 over the texture window.
const MODE_PARAMS = {
  // Baseline — what we had before this prototype work.
  wave: {
    inhale: { bandpassHz: 1500, q: 0.55, peakGain: 0.13 },
    exhale: { bandpassHz: 380,  q: 0.55, peakGain: 0.13 },
  },

  // A — Sibilant Highpass: airy, "shh"/"haa" character.
  //   highpassHz : floor frequency (everything below is cut)
  //   hpQ        : highpass resonance (higher = sharper rolloff)
  //   resHz      : resonance peak frequency (the "formant")
  //   resQ       : resonance sharpness (higher = narrower, more vocal)
  //   resLFOHz   : LFO rate modulating the resonance center
  //   resLFODepth: depth of resonance modulation as a fraction of resHz
  //   peakGain   : bell envelope peak amplitude
  A: {
    inhale: { highpassHz: 2000, hpQ: 0.7, resHz: 2800, resQ: 3.5, resLFOHz: 0.13, resLFODepth: 0.18, peakGain: 0.20 },
    exhale: { highpassHz: 200,  hpQ: 0.7, resHz: 700,  resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
  },

  // B — A's exhale verbatim for both phases.
  //     Inhale and exhale use identical params; only the bell-envelope
  //     timing distinguishes the two phases. Use this to hear the warm
  //     "haa" character without any in/out spectral differentiation.
  B: {
    inhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
  },

  // C — A's exhale with a subtle upward pitch shift for inhale.
  //     Inhale resonance moves to ~780 Hz (vs exhale's 700 Hz) and the
  //     inhale LFO ticks slightly faster. Keeps the warm character but
  //     reintroduces a small in/out perceptual distinction.
  C: {
    inhale: { highpassHz: 200, hpQ: 0.7, resHz: 780, resQ: 3.5, resLFOHz: 0.11, resLFODepth: 0.20, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.09, resLFODepth: 0.20, peakGain: 0.20 },
  },

  // D — A's exhale with more LFO movement on the resonance center.
  //     Faster rate + deeper modulation for both phases — the resonance
  //     "shimmers" more, giving a more animated/alive feel.
  D: {
    inhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.16, resLFODepth: 0.30, peakGain: 0.20 },
    exhale: { highpassHz: 200, hpQ: 0.7, resHz: 700, resQ: 3.5, resLFOHz: 0.13, resLFODepth: 0.30, peakGain: 0.20 },
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

// B / C / D all use buildChain_A — they're parameter variations on the
// same highpass + resonance chain, not different DSP topologies.
const CHAIN_BUILDERS = {
  wave: buildChain_wave,
  A:    buildChain_A,
  B:    buildChain_A,
  C:    buildChain_A,
  D:    buildChain_A,
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
    const ig = (ip === null ? 0 : Math.sin(ip * Math.PI)) * params.inhale.peakGain
    if (Math.abs(ig - lastInhaleGain) > RESCHEDULE_EPS) {
      inhaleChain.envGain.gain.setTargetAtTime(ig, now, TC_ENV)
      lastInhaleGain = ig
    }
    inhaleChain.onProgress?.(ip, now)

    const xp = computeBellProgress(breathPhase, EXHALE_START, EXHALE_END)
    const xg = (xp === null ? 0 : Math.sin(xp * Math.PI)) * params.exhale.peakGain
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
