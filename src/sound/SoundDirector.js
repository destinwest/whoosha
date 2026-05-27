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
import { createBreath }       from './synthBreath'
import { createRumble }       from './synthRumble'
import { createBowl }         from './synthBowl'

const RAMP_FAST = 0.05  // 50ms — for mute toggles

// ── Dysregulation modulation targets ──
// gaugeEffect (0 → ~0.9) drives all of these. Maxima are calibrated against
// the gauge's effective range, not its theoretical 0–1.
const LOWPASS_OPEN_HZ      = 18000   // fully-open (transparent) cutoff
const LOWPASS_CLOSED_HZ    = 600     // fully-closed (world muffled) cutoff
const AMBIENT_LEVEL_FULL   = 1.0
const AMBIENT_LEVEL_MUFFLED = 0.45
const RUMBLE_LEVEL_MAX     = 0.18    // top-of-gauge rumble bus gain

// Breath-texture suppression under dysregulation: at full gauge the inhale
// and exhale textures duck to BREATH_DUCK_FLOOR so the dysregulation chain
// (lowpass + rumble) takes over. The constant drone keeps playing — pulling
// the harmonic ground out from under the user would feel jarring.
const BREATH_DUCK_FLOOR = 0.10

// ── Synergy / breath modulation ──
// breathPhase is a 0–1 saw — sin(2π·phase) gives a smooth ±1 oscillator.
// SYNERGY_BREATH_DEPTH controls how much the bowl swells on each breath.
// 0.2 = ±20% linear amplitude (≈ ±1.6 dB) — felt but never noticed.
const SYNERGY_BREATH_DEPTH = 0.20
const SYNERGY_BUS_BASE     = 0.85    // top-of-stage synergy bus gain (sits under the bed)
const TC_BREATH            = 0.06    // fast-tracking — breathPhase is already smooth

// setTargetAtTime time constants (seconds to ~63% of target).
const TC_FILTER  = 0.10
const TC_LEVEL   = 0.10
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
    // [air + meadow] → ambientBus → ambientLowpass → ambientLevel → master
    //
    // Leaves are no longer a separate submix — they're spawned inside the
    // meadow's breeze events (physically coupled to wind), so the whole
    // ambient bed passes through the dysregulation chain uniformly. When
    // gauge rises, new meadow events are also suppressed (the world "holds
    // its breath" — see meadow.setActivity in update()).
    this.ambientBus = this.ctx.createGain()
    this.ambientBus.gain.value = 1

    this.ambientLowpass = this.ctx.createBiquadFilter()
    this.ambientLowpass.type = 'lowpass'
    this.ambientLowpass.frequency.value = LOWPASS_OPEN_HZ
    this.ambientLowpass.Q.value = 0.7  // mild resonance — natural-sounding sweep

    this.ambientLevel = this.ctx.createGain()
    this.ambientLevel.gain.value = AMBIENT_LEVEL_FULL

    this.ambientBus.connect(this.ambientLowpass)
                   .connect(this.ambientLevel)
                   .connect(this.masterGain)

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
    this._breath   = null
    this._rumble   = null
    this._bowl     = null
    this._noiseBufs = null   // shared between modules

    // Last-scheduled targets for change-throttling in update().
    this._lastLowpass = LOWPASS_OPEN_HZ
    this._lastLevel   = AMBIENT_LEVEL_FULL
    this._lastRumble  = 0
    this._lastSynergy = 0    // last synergyBus gain target (stage × breath swell)
    this._lastBreathDuck = 1 // last breath-textures output-gain target

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
  //
  // Safe to call on every gesture — both the silent-buffer kick and the
  // resume() call are cheap, and re-attempting them is necessary on iOS
  // Safari: there are documented states where the first resume() resolves
  // successfully but the context remains 'suspended' in practice. The
  // prior implementation gated on a one-shot _unlocked flag, which made
  // it impossible to recover from that state — subsequent taps did nothing.
  unlock() {
    // iOS audio-system kick: playing a 1-sample silent buffer forces the
    // AudioSession that backs Web Audio to engage. ctx.resume() alone is
    // sometimes insufficient — there are iOS states where it succeeds as
    // a promise but no audio reaches the speaker until something is
    // actually played. This costs a few microseconds; harmless on
    // desktops, essential on iOS.
    try {
      const buf    = this.ctx.createBuffer(1, 1, 22050)
      const source = this.ctx.createBufferSource()
      source.buffer = buf
      source.connect(this.ctx.destination)
      source.start(0)
    } catch (e) {
      // Older browsers may throw if context is closed or buffer args are odd.
    }

    // Always attempt resume; the previous early-return blocked retries
    // when the first attempt didn't actually unlock the context.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }

    // Marker for the visibilitychange handler — once flipped to true it
    // stays true, so background/foreground transitions can manage the
    // context state from this point on.
    this._unlocked = true
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
  // Generates the noise buffers (one-time, ~50ms), instantiates the ambient
  // synth modules, connects them to their buses, then sets the master gain
  // to its target *instantly* (no fade-in). The breath module's inhale
  // window is timed so that at game start the bell is already partway up —
  // the texture is audible the moment the game opens.
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
    //   breath — drone + inhale/exhale textures locked to breathPhase.
    //            Replaces the prior nature-mimicry approach with intentional
    //            musical ambient that actively guides the breath cycle.
    //   rumble — silent at gauge=0; rises with dysregulation.
    //   bowl   — silent at synergy=0; partials fade in across stages 0–4.
    this._breath = createBreath(this.ctx, this._noiseBufs.pink)
    this._rumble = createRumble(this.ctx)
    this._breath.output.connect(this.ambientBus)
    this._rumble.output.connect(this.rumbleBus)

    // ── Synergy bowl disabled while tuning the ambient breath layer ─────
    // Uncomment these two lines to re-enable. The update() and dispose()
    // bowl blocks below are guarded by `if (this._bowl)` / `?.`, so leaving
    // them untouched is safe — when _bowl is null they degrade to no-ops.
    // this._bowl = createBowl(this.ctx)
    // this._bowl.output.connect(this.synergyBus)
    this.synergyBus.gain.value = 0

    if (this._muted) return  // user is muted; un-mute will restore via setMuted's ramp
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(targetGain, now)
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

    // ── Breath textures ──
    // Forward the snapshot's breathPhase into the breath module so the
    // inhale and exhale textures follow the pacing circle's cycle. Under
    // dysregulation, scale the whole module down (textures + drone alike)
    // toward BREATH_DUCK_FLOOR so the bed recedes behind the lowpass + rumble
    // rather than fighting them. Throttled so we don't queue ramps per-frame.
    if (this._breath) {
      this._breath.update(snapshot.breathPhase || 0)
      const duckTarget = 1 + (BREATH_DUCK_FLOOR - 1) * lpRatio
      if (Math.abs(duckTarget - this._lastBreathDuck) > RESCHEDULE_EPS) {
        this._breath.output.gain.setTargetAtTime(duckTarget, now, TC_LEVEL)
        this._lastBreathDuck = duckTarget
      }
    }

    // ── Rumble level ──
    // Linear ramp from silent to RUMBLE_LEVEL_MAX. Slight perceptual lag
    // (TC_RUMBLE > TC_FILTER) so the rumble "appears" rather than slams in.
    const rumbleTarget = RUMBLE_LEVEL_MAX * lpRatio
    if (Math.abs(rumbleTarget - this._lastRumble) > RESCHEDULE_EPS) {
      this.rumbleBus.gain.setTargetAtTime(rumbleTarget, now, TC_RUMBLE)
      this._lastRumble = rumbleTarget
    }

    // ── Synergy bowl ──
    // Per-partial fade-in is driven by synergyStage; the bus-level breath
    // modulation is driven by breathPhase. Skip both if the bowl module
    // hasn't been instantiated (defensive — startAmbient creates it).
    if (this._bowl) {
      const stage = Math.max(0, Math.min(4, snapshot.synergyStage || 0))
      this._bowl.setStage(stage)

      // Bus gain: scales with stage (so the bowl is silent at stage 0 even if
      // the partials accidentally have residual output) AND breathes with the
      // game's breath cycle. sin(2π·phase) gives a smooth ±1 swing; we map it
      // into ±SYNERGY_BREATH_DEPTH around a unity mid-point.
      const stageGate  = Math.min(1, stage)  // smoothly engages over stage 0→1
      const phase      = snapshot.breathPhase || 0
      const breathMul  = 1 + Math.sin(phase * Math.PI * 2) * SYNERGY_BREATH_DEPTH
      const synergyTarget = SYNERGY_BUS_BASE * stageGate * breathMul
      if (Math.abs(synergyTarget - this._lastSynergy) > RESCHEDULE_EPS) {
        this.synergyBus.gain.setTargetAtTime(synergyTarget, now, TC_BREATH)
        this._lastSynergy = synergyTarget
      }
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────────
  // Idempotent cleanup. Stops all synth modules, closes the AudioContext
  // (which releases the audio thread + cancels every scheduled event), and
  // removes lifecycle listeners.
  dispose() {
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    this._breath?.dispose()
    this._rumble?.dispose()
    this._bowl?.dispose()
    this._breath = this._rumble = this._bowl = null
    try { this.masterGain.disconnect() } catch (e) { /* already disconnected */ }
    try { this.compressor.disconnect()  } catch (e) { /* already disconnected */ }
    if (this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
  }
}
