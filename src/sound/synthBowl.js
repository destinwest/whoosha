// ── synthBowl ──────────────────────────────────────────────────────────────
// Crystal singing bowl synth, mapped to the synergy reward. Each partial
// fades in at a successive synergy stage threshold, so the reward builds
// over time: stage 1 = fundamental only, stage 2 = + second partial, etc.
//
// All variants use pure sine waves — no triangle, square, or saw — because
// crystal singing bowls are essentially banks of slightly-inharmonic
// resonant modes producing very pure tones. The previous design's
// triangle-wave blend on the fundamental added odd harmonics that landed
// as harshness. Pure sines, with controlled detuning between partials to
// produce natural beating, are the actual physics of a bowl.
//
// ── Prototype mode selector ──
// Four character variants to compare. All exist in the C4–C6 range that
// real crystal bowls occupy; the previous C3 design was an octave too
// low and read as "deep and muddy" rather than "bright and singing."
//
//   'A' — Bright Crystal. C5 fundamental + classic harmonic series
//                          (1, 1.5, 2, 3). Closest to a real crystal
//                          singing bowl in the small-tabletop register.
//   'B' — Mid Warm.        A4 fundamental + harmonic series. A common
//                          singing-bowl pitch — warmer than A but still
//                          well above the mud zone.
//   'C' — Tibetan-like.    G4 fundamental + INHARMONIC partials at
//                          bowl-physics ratios (2.4×, 3.7×, 5.6×). More
//                          metallic, less pristine — closer to a struck
//                          bronze bowl than a crystal bowl.
//   'D' — Ethereal.        C5 fundamental + harmonic partials, each with
//                          a slow LFO modulating its frequency for a
//                          shimmery, dreamlike character.
//
// Switch BOWL_MODE below to compare. Each mode's partials are configured
// as an array of objects with tunable traits documented in MODE_PARAMS.

const BOWL_MODE = 'A'  // 'A' | 'B' | 'C' | 'D'

// ── Per-partial tunables ─────────────────────────────────────────────────
// Each partial in a mode is configured by:
//   hz             : base frequency in Hz
//   detune         : cents offset (small detuning produces natural beating
//                     between partials — the audible "shimmer" of a bowl)
//   peakGain       : amplitude when this partial is fully audible (linear)
//   fadeTC         : setTargetAtTime time constant for the fade envelope
//                     (smaller = snappier; larger = more gradual swell)
//   stageThreshold : synergy stage at which this partial begins fading in
//                     (0 = always on once synergy starts; 1 = appears at
//                      stage 1; etc.). Each partial fades 0→peakGain
//                     across a 1-unit stage range above its threshold.
//   lfoHz / lfoDepth (optional) : LFO rate + depth (Hz) modulating the
//                     partial's frequency. Used by mode D for shimmer.
//                     Omit entirely on partials that should stay static.
const MODE_PARAMS = {

  // ── A — Bright Crystal ──
  // C5 + harmonic series. Pure crystal-bowl character.
  A: {
    partials: [
      { hz:  523.25, detune:  0, peakGain: 0.28, fadeTC: 0.10, stageThreshold: 0 }, // C5 fundamental
      { hz:  783.99, detune: +2, peakGain: 0.16, fadeTC: 0.12, stageThreshold: 1 }, // G5 (perfect fifth, slightly sharp)
      { hz: 1046.50, detune: -3, peakGain: 0.10, fadeTC: 0.14, stageThreshold: 2 }, // C6 (octave, slightly flat)
      { hz: 1567.98, detune: +4, peakGain: 0.06, fadeTC: 0.18, stageThreshold: 3 }, // G6 (octave + fifth, shimmer)
    ],
  },

  // ── B — Mid Warm ──
  // A4 + harmonic series. Warmer pitch, classic meditation-bowl tuning.
  B: {
    partials: [
      { hz:  440.00, detune:  0, peakGain: 0.30, fadeTC: 0.10, stageThreshold: 0 }, // A4 fundamental
      { hz:  659.26, detune: +2, peakGain: 0.17, fadeTC: 0.12, stageThreshold: 1 }, // E5 (perfect fifth)
      { hz:  880.00, detune: -3, peakGain: 0.11, fadeTC: 0.14, stageThreshold: 2 }, // A5 (octave)
      { hz: 1760.00, detune: +5, peakGain: 0.06, fadeTC: 0.18, stageThreshold: 3 }, // A6 (high shimmer)
    ],
  },

  // ── C — Tibetan-like ──
  // G4 + INHARMONIC partials at bowl-physics ratios. The 2.4× / 3.7× /
  // 5.6× spacing approximates the mode structure of a struck bronze bowl
  // rather than the harmonic series of a struck string or column of air.
  // Less pristine, more metallic.
  C: {
    partials: [
      { hz:  392.00, detune:  0, peakGain: 0.28, fadeTC: 0.10, stageThreshold: 0 }, // G4 fundamental
      { hz:  940.80, detune: +4, peakGain: 0.14, fadeTC: 0.12, stageThreshold: 1 }, // 2.40× (inharmonic)
      { hz: 1450.40, detune: -5, peakGain: 0.09, fadeTC: 0.14, stageThreshold: 2 }, // 3.70× (inharmonic)
      { hz: 2195.20, detune: +7, peakGain: 0.05, fadeTC: 0.18, stageThreshold: 3 }, // 5.60× (inharmonic)
    ],
  },

  // ── D — Ethereal ──
  // C5 + harmonic partials with slow LFO modulation on each partial's
  // frequency. The LFO produces a subtle vibrato that grows in depth at
  // higher partials — overall character: shimmery, dreamlike, not quite
  // pinning down a single pitch.
  D: {
    partials: [
      { hz:  523.25, detune:  0, peakGain: 0.26, fadeTC: 0.10, stageThreshold: 0, lfoHz: 0.08, lfoDepth: 0.4 },
      { hz:  783.99, detune: +3, peakGain: 0.15, fadeTC: 0.12, stageThreshold: 1, lfoHz: 0.10, lfoDepth: 0.7 },
      { hz: 1046.50, detune: -4, peakGain: 0.10, fadeTC: 0.14, stageThreshold: 2, lfoHz: 0.13, lfoDepth: 1.1 },
      { hz: 1318.51, detune: +6, peakGain: 0.06, fadeTC: 0.18, stageThreshold: 3, lfoHz: 0.17, lfoDepth: 1.6 },
    ],
  },
}

const RESCHEDULE_EPS = 0.002

// ── makePartial ──────────────────────────────────────────────────────────
// Builds one partial: a sine oscillator with optional LFO on its frequency,
// routed through a gain node whose value is driven by setStage().
function makePartial(ctx, config) {
  const gain = ctx.createGain()
  gain.gain.value = 0

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = config.hz
  osc.detune.value = config.detune || 0
  osc.connect(gain)
  osc.start(ctx.currentTime + Math.random() * 0.5)

  const stoppables = [osc]

  // Optional LFO on frequency (used by mode D for shimmer character).
  // Connects to osc.frequency, which sums with the static .value.
  if (config.lfoHz && config.lfoDepth) {
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = config.lfoHz
    const lfoDepthGain = ctx.createGain()
    lfoDepthGain.gain.value = config.lfoDepth
    lfo.connect(lfoDepthGain).connect(osc.frequency)
    lfo.start(ctx.currentTime + Math.random() * 2)
    stoppables.push(lfo)
  }

  return { gain, stoppables, config, lastTarget: 0 }
}

export function createBowl(ctx) {
  const params = MODE_PARAMS[BOWL_MODE]
  if (!params) {
    throw new Error(`synthBowl: unknown BOWL_MODE "${BOWL_MODE}"`)
  }

  const output = ctx.createGain()
  output.gain.value = 1

  const partials = params.partials.map((cfg) => {
    const partial = makePartial(ctx, cfg)
    partial.gain.connect(output)
    return partial
  })

  // ── setStage ────────────────────────────────────────────────────────
  // synergyStage ∈ [0, 4]. Each partial fades in linearly 0→peakGain
  // across a 1-unit stage range starting at its stageThreshold:
  //   stage < threshold       : partial silent
  //   threshold ≤ stage ≤ +1  : partial fading in
  //   stage > threshold + 1   : partial at peakGain
  function setStage(stage) {
    const now = ctx.currentTime
    for (const partial of partials) {
      const t = Math.min(1, Math.max(0, stage - partial.config.stageThreshold))
      const target = partial.config.peakGain * t
      if (Math.abs(target - partial.lastTarget) > RESCHEDULE_EPS) {
        partial.gain.gain.setTargetAtTime(target, now, partial.config.fadeTC)
        partial.lastTarget = target
      }
    }
  }

  // ── dispose ────────────────────────────────────────────────────────
  function dispose() {
    for (const partial of partials) {
      partial.stoppables.forEach((o) => { try { o.stop() } catch (e) {} })
      try { partial.gain.disconnect() } catch (e) {}
    }
    try { output.disconnect() } catch (e) {}
  }

  return { output, setStage, dispose }
}
