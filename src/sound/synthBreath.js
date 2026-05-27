// ── synthBreath ──────────────────────────────────────────────────────────
// Breath-coupled textures that swell during the inhale and exhale phases
// of the Square breath cycle. Two filtered-noise paths (one per phase),
// each gated by a sin(π·t) bell envelope. Holds are silent.
//
// ── Prototype mode selector ──
// The baseline ("wave") sounds ocean-like — that's the spectral signature
// of pink noise through a stationary bandpass. Modes A–D each try a
// different DSP technique to push the texture closer to "breath" or
// "breeze." Switch BREATH_MODE below to compare. Each mode's tunables are
// in MODE_PARAMS so they can be adjusted independently.
//
//   'wave' — baseline. Single bandpass on pink noise. Smooth, broad,
//            spectrally stationary. Reads as "ocean wave."
//   'A'    — Sibilant Highpass. Drops the bass, keeps the airy top end.
//            A resonant bandpass after the highpass adds a vocal-formant
//            character (think "shh" or "haa"). A slow LFO on the resonant
//            center adds subtle life.
//   'B'    — Turbulent Flutter. Same bandpass as baseline, but with two
//            slow LFOs (coprime rates) multiplicatively modulating a
//            post-envelope gain. Adds the granular amplitude turbulence
//            of real breath flow.
//   'C'    — Formant Stack. Three parallel narrow bandpasses tuned like
//            voice formants (F1/F2/F3) so the noise reads more like
//            voiced breath without being identifiable as speech.
//   'D'    — Sweep-and-Air. The bandpass center frequency sweeps DURING
//            the breath — brighter at peak airflow, darker at the edges,
//            matching the physical relationship between flow rate and
//            spectral content.
//
// All modes share window timing, the bell envelope, and the dysregulation
// ducking via the outer output gain (driven by SoundDirector).

const BREATH_MODE = 'A'  // 'wave' | 'A' | 'B' | 'C' | 'D'

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

  // B — Turbulent Flutter: post-envelope gain LFOs add amplitude turbulence.
  //   bandpassHz   : filter center
  //   q            : filter Q
  //   flutterRateA : faster of the two flutter LFOs (Hz)
  //   flutterRateB : slower flutter LFO (Hz); coprime with A
  //   flutterDepth : combined modulation depth (1.0 = full ±1.0 swing)
  //   peakGain     : bell envelope peak
  B: {
    inhale: { bandpassHz: 1500, q: 0.55, flutterRateA: 7.3, flutterRateB: 11.7, flutterDepth: 0.40, peakGain: 0.15 },
    exhale: { bandpassHz: 380,  q: 0.55, flutterRateA: 5.1, flutterRateB: 8.9,  flutterDepth: 0.40, peakGain: 0.15 },
  },

  // C — Formant Stack: three parallel bandpasses approximating voice formants.
  //   formants : [{ hz, q, g }] where g is the per-formant gain (relative)
  //   peakGain : bell envelope peak (multiplies the summed formants)
  C: {
    inhale: {
      formants: [
        { hz: 800,  q: 5,   g: 0.60 },
        { hz: 2400, q: 4,   g: 0.40 },
        { hz: 4500, q: 3,   g: 0.25 },
      ],
      peakGain: 0.18,
    },
    exhale: {
      formants: [
        { hz: 400,  q: 5,   g: 0.60 },
        { hz: 1100, q: 4,   g: 0.40 },
        { hz: 2500, q: 3,   g: 0.25 },
      ],
      peakGain: 0.18,
    },
  },

  // D — Sweep-and-Air: bandpass center sweeps with the bell shape.
  //   minHz, maxHz : sweep range. Filter is at minHz at the edges of the
  //                  window, climbing to maxHz at the peak.
  //   q            : filter Q
  //   peakGain     : bell envelope peak
  D: {
    inhale: { minHz: 500, maxHz: 3500, q: 0.55, peakGain: 0.13 },
    exhale: { minHz: 200, maxHz: 1500, q: 0.55, peakGain: 0.13 },
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
const TC_FILTER      = 0.05
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

function buildChain_B(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = params.bandpassHz
  bp.Q.value = params.q

  const envGain = ctx.createGain()
  envGain.gain.value = 0

  // Multiplicative flutter AFTER the envelope so holds remain truly silent.
  // Two coprime LFOs sum on the flutterGain.gain AudioParam; combined with
  // its base value of 1.0, the gain swings around unity ± flutterDepth.
  const flutterGain = ctx.createGain()
  flutterGain.gain.value = 1.0

  const lfoA = ctx.createOscillator()
  lfoA.type = 'sine'
  lfoA.frequency.value = params.flutterRateA
  const depA = ctx.createGain()
  depA.gain.value = params.flutterDepth * 0.5
  lfoA.connect(depA).connect(flutterGain.gain)
  lfoA.start(ctx.currentTime + Math.random())

  const lfoB = ctx.createOscillator()
  lfoB.type = 'sine'
  lfoB.frequency.value = params.flutterRateB
  const depB = ctx.createGain()
  depB.gain.value = params.flutterDepth * 0.5
  lfoB.connect(depB).connect(flutterGain.gain)
  lfoB.start(ctx.currentTime + Math.random())

  source.connect(bp).connect(envGain).connect(flutterGain)

  return {
    output: flutterGain,
    envGain,
    dispose() {
      try { source.stop() } catch (e) {}
      try { lfoA.stop()   } catch (e) {}
      try { lfoB.stop()   } catch (e) {}
    },
  }
}

function buildChain_C(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const envGain = ctx.createGain()
  envGain.gain.value = 0

  // Three parallel formant arms summing at envGain (Web Audio sums all
  // signals routed to a node's input).
  for (const { hz, q, g } of params.formants) {
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = g
    source.connect(bp).connect(gain).connect(envGain)
  }

  return {
    output: envGain,
    envGain,
    dispose() { try { source.stop() } catch (e) {} },
  }
}

function buildChain_D(ctx, pinkBuffer, params) {
  const source = makeSource(ctx, pinkBuffer)

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = params.minHz
  bp.Q.value = params.q

  const envGain = ctx.createGain()
  envGain.gain.value = 0
  source.connect(bp).connect(envGain)

  let lastFilterHz = params.minHz

  return {
    output: envGain,
    envGain,
    // The filter center traces a sin(π·t) curve in lockstep with the bell —
    // brightest at peak airflow, darker at the window edges.
    onProgress(progress, now) {
      if (progress === null) return
      const sweep = Math.sin(progress * Math.PI)
      const targetHz = params.minHz + (params.maxHz - params.minHz) * sweep
      if (Math.abs(targetHz - lastFilterHz) / lastFilterHz > 0.02) {
        bp.frequency.setTargetAtTime(targetHz, now, TC_FILTER)
        lastFilterHz = targetHz
      }
    },
    dispose() { try { source.stop() } catch (e) {} },
  }
}

const CHAIN_BUILDERS = {
  wave: buildChain_wave,
  A:    buildChain_A,
  B:    buildChain_B,
  C:    buildChain_C,
  D:    buildChain_D,
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
