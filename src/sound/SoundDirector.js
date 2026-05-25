// ── SoundDirector ──────────────────────────────────────────────────────────
// Owns the AudioContext and the entire audio graph for the Square game.
// Phase 2: ambient bus is live (synthesized stream + breeze + leaves). Phase
// 3 will attach the dysregulation chain (lowpass sweep on the ambient bus +
// rumble); Phase 4 will attach the synergy bowl.
//
// Lifecycle contract:
//   const director = new SoundDirector()
//   director.unlock()                       — call inside a user-gesture handler (synchronous!)
//   director.setMuted(true|false)           — toggleable any time
//   director.update({ gaugeEffect, ... })   — call once per rAF from the game loop
//   director.dispose()                      — call on unmount
//
// Design notes:
//   - All Web Audio param changes use scheduled ramps (linear or exponential)
//     so they're interpolated on the audio thread at sample rate — no zipper
//     noise even if rAF is jittery.
//   - The master compressor is set conservatively (low ratio, gentle knee) to
//     act as a safety net, not as a sound-shaping tool.
//   - visibilitychange handler suspends the context when the tab is hidden so
//     audio doesn't drain battery in the background.

import { createNoiseBuffers } from './noiseBuffer'
import { createStream }       from './synthStream'
import { createBreeze }       from './synthBreeze'
import { createLeaves }       from './synthLeaves'

const RAMP_FAST = 0.05  // 50ms — for mute toggles
const RAMP_SLOW = 4.0   // 4s   — for the initial ambient fade-in (Phase 2)

export default class SoundDirector {
  constructor() {
    // Use webkit prefix for Safari < 14.5 compatibility, though our floor is
    // iOS 14+ (iPhone 12 era). Defensive.
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()

    // Master compressor — gentle safety net. Ratio 2:1, soft knee, slow attack
    // so transients aren't squashed; release medium to recover gracefully.
    this.compressor = this.ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -18
    this.compressor.knee.value      = 12
    this.compressor.ratio.value     = 2
    this.compressor.attack.value    = 0.02
    this.compressor.release.value   = 0.25

    // Master gain — single point of control for mute and master volume.
    // Starts at 0 so the first audible content can fade in cleanly.
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0

    this.masterGain.connect(this.compressor).connect(this.ctx.destination)

    // Bus stubs — populated by later phases. Keeping the references here means
    // future modules can wire into a stable spine without touching this file.
    this.ambientBus = this.ctx.createGain()
    this.ambientBus.gain.value = 1
    this.ambientBus.connect(this.masterGain)

    this.synergyBus = this.ctx.createGain()
    this.synergyBus.gain.value = 1
    this.synergyBus.connect(this.masterGain)

    this.rumbleBus = this.ctx.createGain()
    this.rumbleBus.gain.value = 1
    this.rumbleBus.connect(this.masterGain)

    // Internal state
    this._unlocked  = false
    this._muted     = false
    this._started   = false  // becomes true on first startAmbient() call
    this._mutedGain = 1      // last non-muted master target — restored on un-mute

    // Synth-module instances (populated lazily on first startAmbient).
    this._stream   = null
    this._breeze   = null
    this._leaves   = null
    this._noiseBufs = null   // shared between modules

    // Lifecycle: suspend on hidden tab, resume on visible.
    this._onVisibilityChange = () => {
      if (!this._unlocked) return
      if (document.hidden) {
        this.ctx.suspend().catch(() => {})
      } else {
        this.ctx.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)
  }

  // ── unlock ────────────────────────────────────────────────────────────────
  // MUST be called synchronously from inside a user-gesture event handler
  // (pointerdown, click, touchstart). resume() returns a promise but the
  // gesture credit is consumed at call time, not at promise-resolution time.
  // Idempotent — safe to call repeatedly; only the first call actually does
  // anything meaningful.
  unlock() {
    if (this._unlocked) return
    this._unlocked = true
    // ctx.state can be 'suspended' on construction; resume() upgrades it.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  // ── setMuted ──────────────────────────────────────────────────────────────
  // Toggles audio output by ramping the master gain. Visual mute-button state
  // is owned by useMutePref; this method is the audio-side response.
  setMuted(muted) {
    if (this._muted === muted) return
    this._muted = muted
    const target = muted ? 0 : this._mutedGain
    const now    = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
    this.masterGain.gain.linearRampToValueAtTime(target, now + RAMP_FAST)
  }

  // ── startAmbient ──────────────────────────────────────────────────────────
  // Generates the noise buffers (one-time, ~50ms), instantiates the three
  // ambient synth modules (stream + breeze + leaves), connects them to the
  // ambient bus, then ramps the master gain from 0 to its target over 4s.
  // Idempotent — subsequent calls are no-ops.
  startAmbient(targetGain = 1) {
    if (this._started) return
    this._started   = true
    this._mutedGain = targetGain

    // One-time noise buffer generation. Synchronous (~50ms on a phone) but
    // we're inside a user-gesture-adjacent path (post-intro), not on the
    // critical path of the first paint, so it's fine.
    if (!this._noiseBufs) {
      this._noiseBufs = createNoiseBuffers(this.ctx)
    }

    // Spin up the ambient modules — each connects to ambientBus.
    this._stream = createStream(this.ctx, this._noiseBufs.brown)
    this._breeze = createBreeze(this.ctx, this._noiseBufs.pink)
    this._leaves = createLeaves(this.ctx, this._noiseBufs.pink)
    this._stream.output.connect(this.ambientBus)
    this._breeze.output.connect(this.ambientBus)
    this._leaves.output.connect(this.ambientBus)

    if (this._muted) return  // user is muted; don't ramp up yet (un-mute will restore)
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
    this.masterGain.gain.linearRampToValueAtTime(targetGain, now + RAMP_SLOW)
  }

  // ── update ────────────────────────────────────────────────────────────────
  // Called once per rAF from SquareCanvas's frame loop with the game state
  // snapshot. Phase 1: no-op (we just log in dev to verify the contract).
  // Subsequent phases consume this for ambient/dysregulation/synergy modulation.
  update(_snapshot) {
    // Intentionally empty in Phase 1. Will be populated in Phases 2–4.
  }

  // ── dispose ───────────────────────────────────────────────────────────────
  // Idempotent cleanup. Stops all synth modules, closes the AudioContext
  // (which releases the audio thread + cancels every scheduled event), and
  // removes lifecycle listeners.
  dispose() {
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    this._stream?.dispose()
    this._breeze?.dispose()
    this._leaves?.dispose()
    this._stream = this._breeze = this._leaves = null
    try { this.masterGain.disconnect() } catch (e) { /* already disconnected */ }
    try { this.compressor.disconnect()  } catch (e) { /* already disconnected */ }
    if (this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
  }
}
