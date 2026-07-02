// ── synthHexBreath ─────────────────────────────────────────────────────────
// A DEEP, un-windy breath texture for the Hexagon game — a standalone,
// tunable alternative to the Square game's `synthBreath.js`. Where the Square
// breaths are bright, airy, pink-noise "wind/wave" textures (highpass + a
// bright resonant bandpass), this one is built to read as a subtle DEEP breath
// or a gentle, slow breeze:
//
//   • Source: BROWN noise (1/f², bass-heavy) instead of pink — the single
//     biggest lever against "windy." Brown has almost no high-frequency hiss.
//   • Shaping: a LOW-PASS as the primary filter (removes the airy top) plus a
//     gentle low "body" resonance for chest-y warmth — the opposite of the
//     Square's bright formant.
//   • Motion: a slow, shallow cutoff sweep across each breath (inhale opens a
//     little; exhale settles), with an optional very-slow LFO drift for the
//     "gentle breeze" flavor.
//   • Envelope: the same soft asymmetric bell as the Square breath — a quick-
//     ish rise and a long, gentle fall.
//
// NOT WIRED YET. This module only builds the audio graph; nothing plays until
// something drives it. To audition it, mirror how SoundDirector uses the Square
// breath:
//   const breath = createHexBreath(ctx, noiseBufs)   // noiseBufs = createNoiseBuffers(ctx)
//   breath.output.connect(someBus)                   // → ambientBus / master
//   // each frame, from HexagonCanvas getPacing:
//   breath.update(pacingPos.fraction)                // fraction ∈ [0, 6)
//   // on teardown:
//   breath.dispose()
//
// The return shape { output, update, dispose } matches `createBreath` so it can
// drop into the same slot — the ONE difference is what `update` takes: this
// wants the hexagon pacing FRACTION [0,6) (one unit per side), not a 0–1
// breathPhase, because the hexagon has TWO inhale sides and TWO exhale sides
// per lap with non-uniform 4-4-2 timing.

// ── Mode selector ──────────────────────────────────────────────────────────
//   'deepBreath' — subtle, chest-y deep breath. Brown noise, low cutoff, a
//                  small body bump, gentle open/settle sweep, no LFO. Steady.
//   'breeze'     — gentle slow breeze. A touch more air (still low-passed well
//                  below "windy"), wider/softer body, and a slow shallow LFO
//                  drift on the cutoff so the texture never sits still.
export const HEX_BREATH_MODE = 'deepBreath'   // 'deepBreath' | 'breeze'

// ── Per-mode tunables ──────────────────────────────────────────────────────
// Every field is safe to tweak live while auditioning:
//   source        : 'brown' | 'pink'        — brown = deepest/least windy
//   cutoffStartHz : low-pass cutoff at the START of the breath window (Hz)
//   cutoffEndHz   : low-pass cutoff at the END of the window (Hz)
//       inhale usually opens (start < end); exhale settles (start > end).
//   cutoffQ       : low-pass resonance (keep low, ~0.6–0.9, or it whistles)
//   bodyHz        : center of the gentle "chest body" peak (Hz)
//   bodyQ         : width of that peak (lower = wider/softer)
//   bodyGainDb    : boost of the body peak in dB (a few dB — warmth, not honk)
//   lfoHz         : cutoff-drift LFO rate (0 disables). ~0.06–0.1 = "breeze"
//   lfoDepth      : LFO depth as a fraction of the mid cutoff (0.1–0.2)
//   peakGain      : bell-envelope peak amplitude (linear). Keep it quiet.
const HEX_BREATH_PARAMS = {
  deepBreath: {
    inhale: { source: 'brown', cutoffStartHz: 320, cutoffEndHz: 560, cutoffQ: 0.8, bodyHz: 260, bodyQ: 1.4, bodyGainDb: 4, lfoHz: 0,    lfoDepth: 0,    peakGain: 0.16 },
    exhale: { source: 'brown', cutoffStartHz: 520, cutoffEndHz: 300, cutoffQ: 0.8, bodyHz: 220, bodyQ: 1.4, bodyGainDb: 4, lfoHz: 0,    lfoDepth: 0,    peakGain: 0.16 },
  },
  breeze: {
    inhale: { source: 'pink',  cutoffStartHz: 380, cutoffEndHz: 620, cutoffQ: 0.6, bodyHz: 300, bodyQ: 0.8, bodyGainDb: 3, lfoHz: 0.08, lfoDepth: 0.18, peakGain: 0.12 },
    exhale: { source: 'pink',  cutoffStartHz: 560, cutoffEndHz: 360, cutoffQ: 0.6, bodyHz: 280, bodyQ: 0.8, bodyGainDb: 3, lfoHz: 0.07, lfoDepth: 0.18, peakGain: 0.11 },
  },
}

// ── Hexagon side roles ─────────────────────────────────────────────────────
// Sides, traversed by the pacing fraction [0,6): 0,3 = breathe-in;
// 1,4 = breathe-out; 2,5 = hold (silent). Mirrors SIDE_DURATIONS_MS /
// LABEL_TEXTS in HexagonCanvas / HexagonGame.
const INHALE_SIDES = new Set([0, 3])
const EXHALE_SIDES = new Set([1, 4])

// Envelope peak position within a side's 0..1 progress. < 0.5 = faster rise,
// longer gentle fall — how a real breath trails off. Tunable.
const ENVELOPE_PEAK_AT = 0.42

const TC_ENV         = 0.04    // envelope smoothing time-constant (s)
const RESCHEDULE_EPS = 0.002   // skip tiny gain rewrites

// ── Helpers ─────────────────────────────────────────────────────────────────

// Asymmetric bell: 0 → 1 → 0 across progress ∈ [0,1], peaking at `peakAt`.
// Both halves use sin(x·π/2) so the top is smooth (zero derivative each side).
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

// Resolve a noise buffer from whatever was passed in: the { pink, brown } set
// from createNoiseBuffers, or a bare AudioBuffer (used directly regardless of
// the requested `source`).
function resolveBuffer(buffers, source) {
  if (buffers && buffers.pink && buffers.brown) {
    return source === 'pink' ? buffers.pink : buffers.brown
  }
  return buffers   // assume a bare AudioBuffer
}

// ── Chain builder ────────────────────────────────────────────────────────────
// source → low-pass (sweepable + optional LFO drift) → body peak → envGain.
// Returns { output, envGain, onProgress(progress, now), dispose }.
function buildChain(ctx, buffers, p) {
  const source = makeSource(ctx, resolveBuffer(buffers, p.source))

  // Primary shaping: low-pass removes the airy top that reads as "wind."
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = p.cutoffStartHz
  lp.Q.value = p.cutoffQ

  // Gentle chest "body" — a small peaking boost down low for warmth.
  const body = ctx.createBiquadFilter()
  body.type = 'peaking'
  body.frequency.value = p.bodyHz
  body.Q.value = p.bodyQ
  body.gain.value = p.bodyGainDb

  // Optional slow cutoff-drift LFO (the "breeze" motion). Web Audio sums the
  // LFO signal onto the swept base value of lp.frequency.
  let lfo = null
  if (p.lfoHz > 0 && p.lfoDepth > 0) {
    lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = p.lfoHz
    const lfoDepth = ctx.createGain()
    const midHz = (p.cutoffStartHz + p.cutoffEndHz) / 2
    lfoDepth.gain.value = midHz * p.lfoDepth
    lfo.connect(lfoDepth).connect(lp.frequency)
    lfo.start(ctx.currentTime + Math.random() * 2)
  }

  const envGain = ctx.createGain()
  envGain.gain.value = 0
  source.connect(lp).connect(body).connect(envGain)

  let lastCutoff = p.cutoffStartHz

  return {
    output: envGain,
    envGain,
    // Sweep the cutoff from cutoffStartHz → cutoffEndHz across the window.
    onProgress(progress, now) {
      if (progress === null) return
      const target = p.cutoffStartHz + (p.cutoffEndHz - p.cutoffStartHz) * progress
      if (Math.abs(target - lastCutoff) > 1) {
        lp.frequency.setTargetAtTime(target, now, 0.06)
        lastCutoff = target
      }
    },
    dispose() {
      try { source.stop() } catch (e) {}
      if (lfo) try { lfo.stop() } catch (e) {}
    },
  }
}

// ── createHexBreath ──────────────────────────────────────────────────────────
// `buffers` — the { pink, brown } set from createNoiseBuffers(ctx) (preferred,
//             so each phase can pick its source), or a bare AudioBuffer.
export function createHexBreath(ctx, buffers) {
  const params = HEX_BREATH_PARAMS[HEX_BREATH_MODE]
  if (!params) {
    throw new Error(`synthHexBreath: unknown HEX_BREATH_MODE "${HEX_BREATH_MODE}"`)
  }

  // Outer gain — the handle a director would write to for ducking/fades.
  const output = ctx.createGain()
  output.gain.value = 1

  const inhaleChain = buildChain(ctx, buffers, params.inhale)
  const exhaleChain = buildChain(ctx, buffers, params.exhale)
  inhaleChain.output.connect(output)
  exhaleChain.output.connect(output)

  let lastInhaleGain = 0
  let lastExhaleGain = 0

  // `fraction` — hexagon pacing position in [0,6) (one unit per side), from
  // HexagonCanvas getPacing. Inhale swells on sides 0 & 3, exhale on 1 & 4,
  // holds (2 & 5) stay silent.
  function update(fraction) {
    const now = ctx.currentTime
    const f    = ((fraction % 6) + 6) % 6
    const side = Math.floor(f)
    const sp   = f - side   // 0..1 progress within the current side

    const ip = INHALE_SIDES.has(side) ? sp : null
    const ig = (ip === null ? 0 : evaluateAsymmetricBell(ip, ENVELOPE_PEAK_AT)) * params.inhale.peakGain
    if (Math.abs(ig - lastInhaleGain) > RESCHEDULE_EPS) {
      inhaleChain.envGain.gain.setTargetAtTime(ig, now, TC_ENV)
      lastInhaleGain = ig
    }
    inhaleChain.onProgress(ip, now)

    const xp = EXHALE_SIDES.has(side) ? sp : null
    const xg = (xp === null ? 0 : evaluateAsymmetricBell(xp, ENVELOPE_PEAK_AT)) * params.exhale.peakGain
    if (Math.abs(xg - lastExhaleGain) > RESCHEDULE_EPS) {
      exhaleChain.envGain.gain.setTargetAtTime(xg, now, TC_ENV)
      lastExhaleGain = xg
    }
    exhaleChain.onProgress(xp, now)
  }

  function dispose() {
    inhaleChain.dispose()
    exhaleChain.dispose()
    try { output.disconnect() } catch (e) {}
  }

  return { output, update, dispose }
}
