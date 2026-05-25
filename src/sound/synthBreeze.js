// ── synthBreeze ────────────────────────────────────────────────────────────
// Wind through a canopy — pink noise filtered through a wide mid-band, with
// a slow "gust" LFO on gain producing intermittent swells (~17s cycle).
// A second very slow LFO drifts the stereo position, giving the impression
// of wind moving across the listener.
//
// The gust LFO is the personality of this module — it's what makes the
// breeze feel intermittent rather than droning. Center bias + LFO depth
// matched so the gain swings between near-silence and full level.

const FILTER_FREQ   = 800
const FILTER_Q      = 0.7

const GUST_LFO_HZ   = 1 / 17    // ~17s breath of wind
const GUST_BASE     = 0.45      // center gain
const GUST_DEPTH    = 0.45      // ±0.45 → swings between 0 and 0.9

const PAN_LFO_HZ    = 1 / 31    // distinct from stream's 1/23 — no beat patterns
const PAN_DEPTH     = 0.35

const OUTPUT_GAIN   = 0.55

export function createBreeze(ctx, pinkBuffer) {
  // ── Source ──
  const source = ctx.createBufferSource()
  source.buffer = pinkBuffer
  source.loop   = true
  source.start(0, Math.random() * pinkBuffer.duration)

  // ── Filter ──
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = FILTER_FREQ
  filter.Q.value = FILTER_Q

  // ── Gain (modulated by gust LFO) ──
  // base value + LFO modulation = effective gain.
  // OscillatorNode ranges ±1; multiply by GUST_DEPTH then sum into gain.gain.
  const gustGain = ctx.createGain()
  gustGain.gain.value = GUST_BASE

  const gustLfo = ctx.createOscillator()
  gustLfo.type = 'sine'
  gustLfo.frequency.value = GUST_LFO_HZ
  const gustDepth = ctx.createGain()
  gustDepth.gain.value = GUST_DEPTH
  gustLfo.connect(gustDepth).connect(gustGain.gain)
  gustLfo.start(ctx.currentTime + Math.random() * 10)

  // ── Pan ──
  const panner = ctx.createStereoPanner()
  const panLfo = ctx.createOscillator()
  panLfo.type = 'sine'
  panLfo.frequency.value = PAN_LFO_HZ
  const panDepth = ctx.createGain()
  panDepth.gain.value = PAN_DEPTH
  panLfo.connect(panDepth).connect(panner.pan)
  panLfo.start(ctx.currentTime + Math.random() * 10)

  // ── Output ──
  const output = ctx.createGain()
  output.gain.value = OUTPUT_GAIN

  source.connect(filter).connect(gustGain).connect(panner).connect(output)

  return {
    output,
    dispose() {
      try { source.stop() } catch (e) {}
      try { gustLfo.stop() } catch (e) {}
      try { panLfo.stop() } catch (e) {}
      try { output.disconnect() } catch (e) {}
    },
  }
}
