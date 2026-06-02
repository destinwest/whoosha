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
import { createAmbient }      from './synthAmbient'
import { createReverb }       from './reverb'

const RAMP_FAST = 0.05  // 50ms — for mute toggles

// ── Dysregulation modulation targets ──
// gaugeEffect (0 → ~0.9) drives all of these. Maxima are calibrated against
// the gauge's effective range, not its theoretical 0–1.
const LOWPASS_OPEN_HZ      = 18000   // fully-open (transparent) cutoff
const LOWPASS_CLOSED_HZ    = 600     // fully-closed (world muffled) cutoff
const AMBIENT_LEVEL_FULL   = 1.0
// Disabled (was 0.45). Breath/reverb-bus level ducking is no longer in use
// since the breath dysregulation response now happens entirely on the
// breath module's own output gain (BREATH_DUCK_FLOOR). Kept at 1.0 so the
// existing modulation block in update() is a harmless no-op.
const AMBIENT_LEVEL_MUFFLED = 1.0

// Ambient bed dysregulation floor — the sampled forest track ducks to
// silence at full dysregulation. Combined with the breath ducking, the
// dysregulated audio experience is "the world recedes and only your
// breath remains, quietly."
const AMBIENT_BED_FLOOR    = 0.0

// Rumble level disabled (was 0.18). The low-frequency rumble that
// previously appeared during dysregulation read as a penalty cue rather
// than a co-regulating presence. Removed by skipping module instantiation
// in startAmbient and guarding the update block; the rumble bus stays in
// place as infrastructure for possible future use.
const RUMBLE_LEVEL_MAX     = 0.0

// Reverb wet-send level for the synth breath. The dry breath continues
// straight to the ambient bus; this controls how much wet reverb signal
// runs alongside it. 0 = no reverb (dry only), 1.0 = wet equals dry.
// 0.35 gives a noticeable sense of place without becoming washy.
const BREATH_REVERB_WET_LEVEL = 0.35

// Reverb wet-send level for the synergy bowl. Higher than the breath's
// because the bowl is meant to feel far away — "the environment growing
// happy with the user," not a foreground reward bell. Larger wet:dry
// ratio is the standard perceptual cue for distance.
const BOWL_REVERB_WET_LEVEL   = 0.75

// Breath-texture suppression under dysregulation: the inhale and exhale
// textures duck to BREATH_DUCK_FLOOR at full gauge. Previously 0.10 —
// raised to 0.5 so the breath stays clearly audible. With the ambient
// bed silenced and the rumble removed, the breath is now the only audible
// layer during dysregulation; "50% quieter" preserves its presence as a
// gentle cue rather than disappearing it.
const BREATH_DUCK_FLOOR = 0.5

// ── Synergy / breath modulation ──
// breathPhase is a 0–1 saw — sin(2π·phase) gives a smooth ±1 oscillator.
// SYNERGY_BREATH_DEPTH controls how much the bowl swells on each breath.
// 0.2 = ±20% linear amplitude (≈ ±1.6 dB) — felt but never noticed.
const SYNERGY_BREATH_DEPTH = 0.20
// Top-of-buildup synergy bus gain (dry path). The bowl reaches this level
// after BOWL_BUILDUP_MS of sustained synergy at stage 4. Most of the
// audible bowl is its reverb tail — see BOWL_REVERB_WET_LEVEL — which is
// the perceptual cue for "far away."
const SYNERGY_BUS_BASE     = 0.03

// ── Bowl post-synergy buildup ──
// The bowl is silent until the user reaches synergy stage 4 (all visual
// synergy effects are complete). From that moment, a separate "bowl
// progress" accumulator climbs from 0 to 1 over BOWL_BUILDUP_MS. If the
// user drops below stage 4, the accumulator drains over BOWL_DRAIN_MS
// — slower than buildup, so brief drift doesn't silence the bowl, but
// sustained loss of synergy does.
//
// bowlProgress drives BOTH the bowl's per-partial stage emergence (so
// the partials still appear progressively across the 16 s buildup) AND
// the synergyBus gain (so the dry signal scales with progress too).
const BOWL_BUILDUP_MS      = 16000
const BOWL_DRAIN_MS        = 32000

// Synergy stage threshold above which bowl progress accumulates. Below
// this, progress drains. Set to 4 so the bowl is gated until all visual
// synergy effects (amber glow, scale growth, ember particles) are
// complete.
const BOWL_PROGRESS_GATE_STAGE = 4
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
    // Two parallel paths into masterGain, each ducking independently:
    //   sampled forest bed → ambientBedGain → master
    //   synth breath + reverb → ambientBus → ambientLowpass → ambientLevel → master
    //
    // The split allows the bed to duck to silence under dysregulation
    // (AMBIENT_BED_FLOOR = 0) while the breath stays clearly audible at
    // 50% (BREATH_DUCK_FLOOR = 0.5). The breath's spectral muffling via
    // ambientLowpass is preserved on its own path.
    this.ambientBus = this.ctx.createGain()
    this.ambientBus.gain.value = 1

    this.ambientLowpass = this.ctx.createBiquadFilter()
    this.ambientLowpass.type = 'lowpass'
    this.ambientLowpass.frequency.value = LOWPASS_OPEN_HZ
    this.ambientLowpass.Q.value = 0.7  // mild resonance — natural-sounding sweep

    this.ambientLevel = this.ctx.createGain()
    this.ambientLevel.gain.value = AMBIENT_LEVEL_FULL

    // Dedicated gain for the sampled forest bed — ducks separately from the
    // breath path so the user's dysregulation experience is "ambient fades
    // to silence; breath stays present, half as loud."
    this.ambientBedGain = this.ctx.createGain()
    this.ambientBedGain.gain.value = 1
    this.ambientBedGain.connect(this.masterGain)

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
    this._breath          = null
    this._rumble          = null
    this._bowl            = null
    this._ambient         = null
    this._reverb          = null
    this._reverbSend      = null
    this._bowlReverbSend  = null
    this._noiseBufs       = null   // shared between modules

    // Tracks dispose state so async ambient loading can no-op if the
    // director was torn down before the audio file finished downloading
    // and decoding.
    this._disposed = false

    // Last-scheduled targets for change-throttling in update().
    this._lastLowpass = LOWPASS_OPEN_HZ
    this._lastLevel   = AMBIENT_LEVEL_FULL
    this._lastRumble  = 0
    this._lastSynergy = 0       // last synergyBus gain target (stage × breath swell)
    this._lastBreathDuck = 1    // last breath-textures output-gain target
    this._lastAmbientBedDuck = 1 // last ambientBedGain target — ducks to silence under dysreg

    // Bowl progress accumulator (0..1). Climbs while synergyStage >= 4,
    // drains otherwise. See BOWL_BUILDUP_MS / BOWL_DRAIN_MS.
    this._bowlProgress       = 0
    this._lastUpdateAudioTime = null  // for dt computation in update()

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

  // ── fadeOut ───────────────────────────────────────────────────────────────
  // Linearly ramps master gain to 0 over durationS seconds. Used by the
  // game-completion phase to fade audio gracefully as the session ends.
  // Cancels any currently-scheduled gain automation first, so calling this
  // mid-fade or mid-startup-ramp behaves correctly.
  fadeOut(durationS = 2.0) {
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
    this.masterGain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, durationS))
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
    //   breath  — inhale/exhale textures locked to breathPhase. Routes
    //             through ambientBus → ambientLowpass → ambientLevel → master.
    //   rumble  — DISABLED. Previously appeared during dysregulation; read
    //             as a penalty rather than a co-regulating cue. Lines below
    //             commented out; the rumbleBus infrastructure remains in
    //             place for possible future re-introduction.
    //   bowl    — synergy reward, partials fade in stage by stage.
    //   ambient — sampled forest-meadow bed, loaded async. Routes through
    //             its own ambientBedGain → master (NOT through ambientBus)
    //             so it can duck independently of the breath path.
    this._breath = createBreath(this.ctx, this._noiseBufs.pink)
    this._breath.output.connect(this.ambientBus)  // dry path

    // Rumble disabled — uncomment to re-enable.
    // this._rumble = createRumble(this.ctx)
    // this._rumble.output.connect(this.rumbleBus)

    // Synergy bowl — fades in stage by stage as the user maintains close
    // pacing. See synthBowl.js for the four variants and per-partial
    // tunables. Disposal is handled via this._bowl?.dispose() in dispose().
    this._bowl = createBowl(this.ctx)
    this._bowl.output.connect(this.synergyBus)

    // Reverb sends: both the breath and the bowl route through wet sends
    // into the same reverb, which returns to the ambient bus. Both layers
    // share the same acoustic space (the forest's reflections):
    //
    //   breath.output ─┬──────────────────────────────────► ambientBus (dry)
    //                  └─► reverbSend (0.35) ─►┐
    //                                          ├─► reverb ─► ambientBus (wet)
    //   bowl.output ─► synergyBus ──┬─────────► master      │
    //                               └─► bowlReverbSend (0.75) ──────┘
    //
    // Bowl wet branches from synergyBus (NOT bowl.output directly), so the
    // wet signal is also gated by the bowlProgress-driven bus gain. Result:
    // both dry and wet stay silent until bowl progress begins after the
    // user reaches synergy stage 4, and both ramp together over the
    // BOWL_BUILDUP_MS window.
    this._reverb = createReverb(this.ctx)
    this._reverb.output.connect(this.ambientBus)

    this._reverbSend = this.ctx.createGain()
    this._reverbSend.gain.value = BREATH_REVERB_WET_LEVEL
    this._breath.output.connect(this._reverbSend)
    this._reverbSend.connect(this._reverb.input)

    this._bowlReverbSend = this.ctx.createGain()
    this._bowlReverbSend.gain.value = BOWL_REVERB_WET_LEVEL
    this.synergyBus.connect(this._bowlReverbSend)
    this._bowlReverbSend.connect(this._reverb.input)

    // Ambient bed loads asynchronously (fetch + decode). Fire and forget;
    // the synth breath plays immediately, and the ambient swells in once
    // the file is ready (typically 100–500ms). The promise can resolve
    // AFTER dispose() in the worst case (user backs out of the game during
    // a slow first load), so we check _disposed and clean up if so.
    createAmbient(this.ctx)
      .then((ambient) => {
        if (this._disposed) {
          ambient.dispose()
          return
        }
        this._ambient = ambient
        ambient.output.connect(this.ambientBedGain)
      })
      .catch((err) => {
        // Non-fatal: the game works without the ambient bed. Capture so
        // delivery failures show up in observability, not the user's
        // browser console.
        if (typeof window !== 'undefined' && window.Sentry) {
          window.Sentry.captureException(err, { tags: { area: 'ambient-load' } })
        }
      })

    // synergyBus starts silent (gain 0). update() ramps it up the moment
    // synergyStage > 0, modulated also by breathPhase for the gentle
    // breath-locked swell.
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

    // ── Ambient level (breath/reverb bus) ──
    // Currently a no-op since AMBIENT_LEVEL_FULL == AMBIENT_LEVEL_MUFFLED.
    // The breath's dysregulation duck happens at the breath-module level
    // below (BREATH_DUCK_FLOOR), not here. Block kept so re-enabling the
    // bus-level duck is a single constant change.
    const levelTarget = AMBIENT_LEVEL_FULL + (AMBIENT_LEVEL_MUFFLED - AMBIENT_LEVEL_FULL) * lpRatio
    if (Math.abs(levelTarget - this._lastLevel) > RESCHEDULE_EPS) {
      this.ambientLevel.gain.setTargetAtTime(levelTarget, now, TC_LEVEL)
      this._lastLevel = levelTarget
    }

    // ── Ambient bed (sampled forest track) ──
    // Ducks from 1.0 (regulated) toward AMBIENT_BED_FLOOR (0 = silent) as
    // the gauge climbs. The bed lives on its own gain node directly into
    // master, separate from ambientBus, so this duck does NOT affect the
    // breath or its reverb tail.
    const bedTarget = 1 + (AMBIENT_BED_FLOOR - 1) * lpRatio
    if (Math.abs(bedTarget - this._lastAmbientBedDuck) > RESCHEDULE_EPS) {
      this.ambientBedGain.gain.setTargetAtTime(bedTarget, now, TC_LEVEL)
      this._lastAmbientBedDuck = bedTarget
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
    // Guarded — _rumble is null when the rumble module is disabled in
    // startAmbient. Block kept so re-enabling the rumble is a single
    // uncomment in startAmbient.
    if (this._rumble) {
      const rumbleTarget = RUMBLE_LEVEL_MAX * lpRatio
      if (Math.abs(rumbleTarget - this._lastRumble) > RESCHEDULE_EPS) {
        this.rumbleBus.gain.setTargetAtTime(rumbleTarget, now, TC_RUMBLE)
        this._lastRumble = rumbleTarget
      }
    }

    // ── Synergy bowl ──
    // The bowl is gated by a "bowl progress" accumulator (0..1) that
    // climbs while synergyStage >= BOWL_PROGRESS_GATE_STAGE and drains
    // otherwise. Buildup: BOWL_BUILDUP_MS. Drain: BOWL_DRAIN_MS (slower,
    // so brief drift doesn't punish the user). The accumulator drives
    // BOTH the bowl's per-partial stage emergence (so partials still
    // appear progressively across the buildup window) and the synergyBus
    // gain (so the dry signal scales with progress too).
    if (this._bowl) {
      // Compute frame delta from the audio context clock. First call has
      // no previous sample, default to ~one frame (16.67 ms).
      const audioNow = now
      const dtMs = this._lastUpdateAudioTime !== null
        ? Math.max(0, (audioNow - this._lastUpdateAudioTime) * 1000)
        : 16.67
      this._lastUpdateAudioTime = audioNow

      const synergyStage = Math.max(0, Math.min(4, snapshot.synergyStage || 0))
      if (synergyStage >= BOWL_PROGRESS_GATE_STAGE) {
        this._bowlProgress = Math.min(1, this._bowlProgress + dtMs / BOWL_BUILDUP_MS)
      } else {
        this._bowlProgress = Math.max(0, this._bowlProgress - dtMs / BOWL_DRAIN_MS)
      }

      // Drive the bowl's per-partial emergence from progress (×4 maps the
      // [0,1] progress into the bowl's [0,4] stage range, so the partials
      // appear at progress 0.25, 0.50, 0.75, 1.00).
      this._bowl.setStage(this._bowlProgress * 4)

      // Bus gain: scales linearly with progress and modulates with the
      // breath. sin(2π·phase) gives a smooth ±1 swing mapped into
      // ±SYNERGY_BREATH_DEPTH around unity.
      const phase     = snapshot.breathPhase || 0
      const breathMul = 1 + Math.sin(phase * Math.PI * 2) * SYNERGY_BREATH_DEPTH
      const synergyTarget = SYNERGY_BUS_BASE * this._bowlProgress * breathMul
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
    this._disposed = true
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    this._breath?.dispose()
    this._rumble?.dispose()
    this._bowl?.dispose()
    this._ambient?.dispose()
    this._reverb?.dispose()
    try { this._reverbSend?.disconnect()     } catch (e) { /* already disconnected */ }
    try { this._bowlReverbSend?.disconnect() } catch (e) { /* already disconnected */ }
    try { this.ambientBedGain.disconnect()   } catch (e) { /* already disconnected */ }
    this._breath = this._rumble = this._bowl = this._ambient = null
    this._reverb = this._reverbSend = this._bowlReverbSend = null
    try { this.masterGain.disconnect() } catch (e) { /* already disconnected */ }
    try { this.compressor.disconnect()  } catch (e) { /* already disconnected */ }
    if (this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
  }
}
