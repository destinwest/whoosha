// ── synthAir ───────────────────────────────────────────────────────────────
// Barely-perceptible room tone. The reason it exists: true digital silence
// has a sterile quality that breaks immersion (the brain interprets the
// absence of any hiss as "I am in a soundproof booth," not "I am outside").
// A whisper of lowpassed noise restores the sense of being in a real place
// without registering as a layer the listener can identify.
//
// Tuning targets:
//   - Lowpass at 350 Hz so the noise is felt as "air pressure," not heard as hiss
//   - Output gain ~3% — right at the perceptual floor on a phone speaker
//   - Very slow gain LFO (~40 s period) gives the merest sense of "breathing
//     atmosphere" — too slow to consciously notice

const LOWPASS_HZ   = 350
const LOWPASS_Q    = 0.5
const BREATH_LFO_HZ = 1 / 41    // ~41s — coprime with any other module's LFO
const BREATH_DEPTH  = 0.008     // ±0.008 around a 0.03 mean — micro-modulation
const BASE_GAIN     = 0.03

export function createAir(ctx, brownBuffer) {
  const source = ctx.createBufferSource()
  source.buffer = brownBuffer
  source.loop = true
  source.start(0, Math.random() * brownBuffer.duration)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = LOWPASS_HZ
  lp.Q.value = LOWPASS_Q

  const output = ctx.createGain()
  output.gain.value = BASE_GAIN

  const breathLfo = ctx.createOscillator()
  breathLfo.type = 'sine'
  breathLfo.frequency.value = BREATH_LFO_HZ
  const breathDepth = ctx.createGain()
  breathDepth.gain.value = BREATH_DEPTH
  breathLfo.connect(breathDepth).connect(output.gain)
  breathLfo.start(ctx.currentTime + Math.random() * 5)

  source.connect(lp).connect(output)

  return {
    output,
    dispose() {
      try { source.stop() } catch (e) {}
      try { breathLfo.stop() } catch (e) {}
      try { output.disconnect() } catch (e) {}
    },
  }
}
