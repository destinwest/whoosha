// ── synthRumble ────────────────────────────────────────────────────────────
// Subliminal low rumble — sine at ~50 Hz with a slow tremolo (~0.3 Hz)
// modulating its amplitude by a few dB. Surfaces only during the dysregulated
// state, where it adds a sense of "the world muffling around you" without
// being identifiable as a tone.
//
// Why a pure sine rather than filtered noise?
//   - At 50 Hz the speaker on a phone barely reproduces the fundamental
//     anyway; what the user perceives is a felt pressure + the speaker's
//     second harmonic (~100 Hz). A pure sine gives the cleanest harmonic
//     content for that minimal reproduction path.
//   - Pure sine costs one OscillatorNode vs. a buffer + filter chain.
//
// Output is a single GainNode at 1.0 (caller controls level externally via
// the rumbleBus that this connects into).

const FUNDAMENTAL_HZ = 50
const TREMOLO_HZ     = 0.3
const TREMOLO_DEPTH  = 0.15  // ±15% amplitude swing → ~3 dB swing

export function createRumble(ctx) {
  // ── Source ──
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = FUNDAMENTAL_HZ

  // ── Tremolo ──
  // Inner gain whose value (1.0) is modulated by an LFO of ±TREMOLO_DEPTH,
  // so effective amplitude swings between 1-depth and 1+depth.
  const tremGain = ctx.createGain()
  tremGain.gain.value = 1.0

  const tremLfo = ctx.createOscillator()
  tremLfo.type = 'sine'
  tremLfo.frequency.value = TREMOLO_HZ
  const tremDepth = ctx.createGain()
  tremDepth.gain.value = TREMOLO_DEPTH
  tremLfo.connect(tremDepth).connect(tremGain.gain)

  // ── Output ──
  const output = ctx.createGain()
  output.gain.value = 1.0

  osc.connect(tremGain).connect(output)

  osc.start(ctx.currentTime + Math.random() * 0.5)
  tremLfo.start(ctx.currentTime + Math.random() * 2)

  return {
    output,
    dispose() {
      try { osc.stop()     } catch (e) {}
      try { tremLfo.stop() } catch (e) {}
      try { output.disconnect() } catch (e) {}
    },
  }
}
