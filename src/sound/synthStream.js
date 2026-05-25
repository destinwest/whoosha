// ── synthStream ────────────────────────────────────────────────────────────
// Distant water — brown noise routed through three parallel bandpass filters
// at ~200/500/1500 Hz, each with an independent LFO modulating its center
// frequency by ±15%. The cross-modulation of the three bands creates the
// "movement" of flowing water without any source-side variation.
//
// Why three bands?
//   - 200 Hz: the low body — water mass moving past
//   - 500 Hz: the mid splash — rocks, gurgling
//   - 1500 Hz: the high air — surface texture
// Independent LFO periods (14s / 9s / 7.7s) — coprime so the combined cycle
// never quite repeats, eliminating perceived "breathing" of the filter array.
//
// Output is a single GainNode at unity gain; caller connects it to a bus.

const FILTER_CONFIGS = [
  { freq: 200,  q: 1.4, lfoHz: 1 / 14,  depth: 30  },  // ±30 Hz wobble (15% of 200)
  { freq: 500,  q: 1.4, lfoHz: 1 / 9,   depth: 75  },
  { freq: 1500, q: 1.4, lfoHz: 1 / 7.7, depth: 225 },
]

const PAN_LFO_HZ    = 1 / 23     // very slow stereo drift
const PAN_DEPTH     = 0.15       // ±0.15 of the [-1, 1] pan range
const OUTPUT_GAIN   = 0.45       // empirical mix level vs. breeze + leaves

export function createStream(ctx, brownBuffer) {
  // ── Source ──
  const source = ctx.createBufferSource()
  source.buffer = brownBuffer
  source.loop   = true
  // Randomize start offset so multiple synths (or reloads) don't lock into
  // the same noise sequence.
  source.start(0, Math.random() * brownBuffer.duration)

  // ── Output trunk ──
  const output  = ctx.createGain()
  output.gain.value = OUTPUT_GAIN

  const panner = ctx.createStereoPanner()
  panner.connect(output)

  // ── Three parallel bandpass arms ──
  const lfoNodes = []
  for (const { freq, q, lfoHz, depth } of FILTER_CONFIGS) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    filter.Q.value = q

    // LFO: OscillatorNode (-1..+1) → depthGain → filter.frequency
    // The modulation is ADDED to filter.frequency.value, so center stays at `freq`.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = lfoHz
    // Random phase offset per filter — without this, all three peak together
    // and create an audible 1/14-Hz pulse.
    const depthGain = ctx.createGain()
    depthGain.gain.value = depth
    lfo.connect(depthGain).connect(filter.frequency)
    lfo.start(ctx.currentTime + Math.random() * 4)  // phase scatter

    source.connect(filter).connect(panner)
    lfoNodes.push(lfo)
  }

  // ── Stereo pan LFO ──
  const panLfo = ctx.createOscillator()
  panLfo.type = 'sine'
  panLfo.frequency.value = PAN_LFO_HZ
  const panDepth = ctx.createGain()
  panDepth.gain.value = PAN_DEPTH
  panLfo.connect(panDepth).connect(panner.pan)
  panLfo.start(ctx.currentTime + Math.random() * 5)
  lfoNodes.push(panLfo)

  return {
    output,
    // Disposal — caller invokes on teardown. Stops sources, disconnects everything.
    dispose() {
      try { source.stop() } catch (e) { /* already stopped */ }
      lfoNodes.forEach((osc) => { try { osc.stop() } catch (e) {} })
      try { output.disconnect() } catch (e) {}
    },
  }
}
