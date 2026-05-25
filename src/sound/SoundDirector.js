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
import { createRumble }       from './synthRumble'

const RAMP_FAST = 0.05  // 50ms — for mute toggles
const RAMP_SLOW = 4.0   // 4s   — for the initial ambient fade-in (Phase 2)

// ── Dysregulation modulation targets ──
// gaugeEffect (0 → ~0.9) drives all of these. Maxima are calibrated against
// the gauge's effective range, not its theoretical 0–1.
const LOWPASS_OPEN_HZ      = 18000   // fully-open (transparent) cutoff
const LOWPASS_CLOSED_HZ    = 600     // fully-closed (world muffled) cutoff
const AMBIENT_LEVEL_FULL   = 1.0
const AMBIENT_LEVEL_MUFFLED = 0.45
const LEAVES_GAUGE_THRESHOLD = 0.55   // below this, leaves fully audible; fades out by ~0.85
const LEAVES_GAUGE_FULL_OUT  = 0.85
const RUMBLE_LEVEL_MAX     = 0.18    // top-of-gauge rumble bus gain

// setTargetAtTime time constants (seconds to ~63% of target).
const TC_FILTER  = 0.10
const TC_LEVEL   = 0.10
const TC_LEAVES  = 0.25
const TC_RUMBLE  = 0.12

// Min target change before re-scheduling — avoids zipper from per-frame
// micro-modulation of already-stable params.
const RESCHEDULE_EPS = 0.005

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

    // ── Ambient signal chain ──
    // [stream + breeze] → ambientBus → ambientLowpass → ambientLevel → master
    // [leaves]          → leavesSubmix → ambientBus (so leaves can be faded
    //                     out separately under dysregulation while the bed
    //                     continues through the same lowpass + level chain)
    this.ambientBus = this.ctx.createGain()
    this.ambientBus.gain.value = 1

    this.ambientLowpass = this.ctx.createBiquadFilter()
    this.ambientLowpass.type = 'lowpass'
    this.ambientLowpass.frequency.value = LOWPASS_OPEN_HZ
    this.ambientLowpass.Q.value = 0.7  // mild resonance — natural-sounding sweep

    this.ambientLevel = this.ctx.createGain()
    this.ambientLevel.gain.value = AMBIENT_LEVEL_FULL

    this.leavesSubmix = this.ctx.createGain()
    this.leavesSubmix.gain.value = 1   // gaugeEffect modulates this

    this.ambientBus.connect(this.ambientLowpass)
                   .connect(this.ambientLevel)
                   .connect(this.masterGain)
    this.leavesSubmix.connect(this.ambientBus)

    // ── Synergy bus (Phase 4) ──
    this.synergyBus = this.ctx.createGain()
    this.synergyBus.gain.value = 1
    this.synergyBus.connect(this.masterGain)

    // ── Rumble bus ──
    // Starts silent; gaugeEffect drives the level up under dysregulation.
    this.rumbleBus = this.ctx.createGain()
    this.rumbleBus.gain.value = 0
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
    this._rumble   = null
    this._noiseBufs = null   // shared between modules

    // Last-scheduled targets for change-throttling in update().
    this._lastLowpass = LOWPASS_OPEN_HZ
    this._lastLevel   = AMBIENT_LEVEL_FULL
    this._lastLeaves  = 1
    this._lastRumble  = 0

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

    // Spin up the ambient modules.
    // Stream + breeze feed ambientBus directly. Leaves route through the
    // leavesSubmix so they can be faded out independently under dysregulation
    // (while stream + breeze remain audible, just muffled).
    // Rumble feeds the rumbleBus, which is silent by default.
    this._stream = createStream(this.ctx, this._noiseBufs.brown)
    this._breeze = createBreeze(this.ctx, this._noiseBufs.pink)
    this._leaves = createLeaves(this.ctx, this._noiseBufs.pink)
    this._rumble = createRumble(this.ctx)
    this._stream.output.connect(this.ambientBus)
    this._breeze.output.connect(this.ambientBus)
    this._leaves.output.connect(this.leavesSubmix)
    this._rumble.output.connect(this.rumbleBus)

    if (this._muted) return  // user is muted; don't ramp up yet (un-mute will restore)
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
    this.masterGain.gain.linearRampToValueAtTime(targetGain, now + RAMP_SLOW)
  }

  // ── update ────────────────────────────────────────────────────────────────
  // Called once per rAF from SquareCanvas's frame loop. Phase 3 consumes
  // `gaugeEffect` to drive the dysregulation modulation chain. Phase 4 will
  // add `synergyStage` and `breathPhase` handling.
  //
  // Modulation uses setTargetAtTime (smooth exponential approach) rather
  // than linearRampToValueAtTime — this lets us update every frame without
  // queueing thousands of ramps. The time constants are tuned so per-frame
  // jitter in the input signal is filtered into a perceptually smooth ramp.
  // Targets are change-throttled (>RESCHEDULE_EPS) to avoid noise.
  update(snapshot) {
    if (!this._started || !snapshot) return
    const now = this.ctx.currentTime
    const gauge = Math.max(0, Math.min(1, snapshot.gaugeEffect || 0))

    // ── Ambient lowpass ──
    // Exponential mapping in log-frequency space: gauge=0 → fully open,
    // gauge≥0.9 → fully closed. Subjectively matches the visual desaturation.
    const lpRatio = Math.min(gauge / 0.9, 1)
    const lpTarget = LOWPASS_OPEN_HZ * Math.pow(LOWPASS_CLOSED_HZ / LOWPASS_OPEN_HZ, lpRatio)
    if (Math.abs(lpTarget - this._lastLowpass) / this._lastLowpass > RESCHEDULE_EPS) {
      this.ambientLowpass.frequency.setTargetAtTime(lpTarget, now, TC_FILTER)
      this._lastLowpass = lpTarget
    }

    // ── Ambient level ──
    const levelTarget = AMBIENT_LEVEL_FULL + (AMBIENT_LEVEL_MUFFLED - AMBIENT_LEVEL_FULL) * lpRatio
    if (Math.abs(levelTarget - this._lastLevel) > RESCHEDULE_EPS) {
      this.ambientLevel.gain.setTargetAtTime(levelTarget, now, TC_LEVEL)
      this._lastLevel = levelTarget
    }

    // ── Leaves submix ──
    // Stays at 1.0 until gauge crosses the threshold, then ramps to 0 by
    // LEAVES_GAUGE_FULL_OUT. The transients "vanish" into the muffled world.
    let leavesTarget = 1
    if (gauge >= LEAVES_GAUGE_THRESHOLD) {
      const t = Math.min(1, (gauge - LEAVES_GAUGE_THRESHOLD) / (LEAVES_GAUGE_FULL_OUT - LEAVES_GAUGE_THRESHOLD))
      leavesTarget = 1 - t
    }
    if (Math.abs(leavesTarget - this._lastLeaves) > RESCHEDULE_EPS) {
      this.leavesSubmix.gain.setTargetAtTime(leavesTarget, now, TC_LEAVES)
      this._lastLeaves = leavesTarget
    }

    // ── Rumble level ──
    // Linear ramp from silent to RUMBLE_LEVEL_MAX. Slight perceptual lag
    // (TC_RUMBLE > TC_FILTER) so the rumble "appears" rather than slams in.
    const rumbleTarget = RUMBLE_LEVEL_MAX * lpRatio
    if (Math.abs(rumbleTarget - this._lastRumble) > RESCHEDULE_EPS) {
      this.rumbleBus.gain.setTargetAtTime(rumbleTarget, now, TC_RUMBLE)
      this._lastRumble = rumbleTarget
    }
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
    this._rumble?.dispose()
    this._stream = this._breeze = this._leaves = this._rumble = null
    try { this.masterGain.disconnect() } catch (e) { /* already disconnected */ }
    try { this.compressor.disconnect()  } catch (e) { /* already disconnected */ }
    if (this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
  }
}
