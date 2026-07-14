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

import { createNoiseBuffers }     from './noiseBuffer'
import { createBreath }           from './synthBreath'
import { createRumble }           from './synthRumble'
import { createBowl }             from './synthBowl'
import { createAmbient }          from './synthAmbient'
import { createReverb }           from './reverb'
import { getSharedAudioContext }  from './sharedContext'

const RAMP_FAST = 0.05  // 50ms — for mute toggles

// ── Interruption recovery pump ──
// After an iOS interruption the context often lands in 'suspended', and a
// single resume() right after the app returns to the foreground doesn't take
// (the audio session hasn't finished tearing down the interruption). Rather
// than force the user to tap, we retry resume() on a short interval until the
// context reports 'running'. Capped so the timer can't spin forever if recovery
// genuinely needs a user gesture — the next touch on the game restarts it.
const RECOVERY_INTERVAL_MS  = 400
const RECOVERY_MAX_ATTEMPTS = 40   // ~16s of retrying while the page is visible

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
    // Reuse the app-lifetime shared context (see getSharedAudioContext).
    this.ctx = getSharedAudioContext()

    // Build the persistent bus spine (compressor, master gain, ambient /
    // synergy / rumble buses) on the context. Factored into a method so
    // _rebuildSpine() can rebuild it in place during interruption recovery
    // (it must be rebuilt while the context is suspended — see _advanceRecovery).
    this._buildBusSpine()

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

    // True once the audio has been backgrounded (page hidden / phone locked /
    // iOS 'interrupted') since the last successful (re)build — i.e. the playing
    // source nodes are presumed dead and must be respawned once the context is
    // 'running' again. iOS Safari stops every source node (buffer sources +
    // oscillators) on lock/background, and they are one-shot: resume() restores
    // the context clock but NOT the dead sources.
    //
    // IMPORTANT: we key on *backgrounding*, NOT on the 'interrupted' state.
    // On-device logs show iOS does not reliably surface 'interrupted' — a lock
    // can transition the context straight to 'suspended' (especially once our
    // own visibility handler suspends it on 'hidden'). Keying on the reliable
    // visibilitychange→hidden signal (plus 'interrupted' when it does fire)
    // catches every case. Desktop tab-switches set this too and rebuild on
    // return; that's a harmless ambient restart, and iOS correctness wins.
    this._needsRecovery = false

    // setInterval handle + attempt counter for the post-interruption resume
    // pump (see _startRecoveryPump). null when no recovery is in progress.
    this._recoveryTimer    = null
    this._recoveryAttempts = 0

    // Recovery ordering flag: true once the bus spine has been rebuilt for the
    // current recovery (which MUST happen while the context is suspended). The
    // sources are then built only after the context reaches 'running'. Reset on
    // each new background/interruption. See _advanceRecovery.
    this._spineRebuilt = false

    // ── Lifecycle: statechange-driven interruption recovery ──
    // statechange reflects the actual audio-engine state — the correct signal
    // for catching iOS audio-session interruptions (background, phone call,
    // another app grabbing audio), including ones that don't change tab
    // visibility. The visibility handler below suspends on hidden ONLY when the
    // context is still 'running' (tab switch) — it never touches an
    // 'interrupted' context, so the interruption-recovery signal here stays
    // clean.
    this._onStateChange = () => {
      const state = this.ctx.state
      if (this._disposed) return
      if (state === 'interrupted') {
        // iOS interruption: sources AND the spine's output binding are dead.
        // Mark for recovery and force a fresh spine rebuild on this cycle.
        this._needsRecovery = true
        this._spineRebuilt  = false
      }
      // Let the state machine decide what to do at the current state. It is the
      // single recovery driver shared by statechange, visibility, the gesture,
      // and the pump — see _advanceRecovery.
      this._advanceRecovery()
    }
    this.ctx.addEventListener('statechange', this._onStateChange)

    // ── Visibility: the PRIMARY interruption signal ──
    // On-device iOS logs show a phone lock often fires visibilitychange→hidden
    // while the context is still 'running', and then transitions to 'suspended'
    // (NOT 'interrupted'). So 'hidden' — not the statechange — is our reliable
    // "the audio is being backgrounded and its sources are about to die" signal.
    //
    // On hidden (while started): mark _needsRecovery so the return path knows it
    // must respawn the sources, then suspend the context if it's still running
    // (stops background bleed on desktop; on iOS the OS suspends/interrupts it
    // for us). The statechange 'suspended' branch will try the pump, which
    // no-ops while we're hidden.
    //
    // On visible: if we were backgrounded, run the recovery state machine, which
    // rebuilds the spine while suspended and the sources once running. For a
    // plain non-backgrounded change, just resume + kick.
    this._onVisibilityChange = () => {
      if (!this._unlocked) return
      if (document.hidden) {
        // Going to background: the sources and the spine's output binding will
        // die. Flag for recovery and force a fresh spine rebuild on return.
        if (this._started) {
          this._needsRecovery = true
          this._spineRebuilt  = false
        }
        this._stopRecoveryPump()
        if (this.ctx.state === 'running') {
          this.ctx.suspend().catch(() => {})
        }
        return
      }
      if (this._needsRecovery && this._started && !this._disposed) {
        this._advanceRecovery()
        return
      }
      this.ctx.resume().catch(() => {})
      this._playSilentBuffer()
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)

    // ── Defense-in-depth unlock listeners ──
    // The game container's onPointerDown is still the primary unlock
    // path during normal use. But on a page reload landing directly at
    // /games/square, a user who lets the intro auto-complete and then
    // begins tracing might not produce a pointerdown that propagates
    // cleanly to the container in every scenario. These document-level
    // listeners are a belt-and-suspenders catch: ANY user gesture
    // anywhere on the page triggers unlock(), and the unlock() body is
    // already idempotent so repeated calls are cheap.
    this._unlockListener = () => this.unlock()
    this._unlockEventTypes = ['pointerdown', 'touchstart', 'click', 'keydown']
    this._unlockEventTypes.forEach((ev) => {
      document.addEventListener(ev, this._unlockListener, { passive: true })
    })

    // ── Eager unlock attempt ──
    // Most desktop browsers (Chrome with sufficient Media Engagement
    // Index for the domain, Firefox, recent Safari) allow ctx.resume()
    // to succeed WITHOUT a user gesture if the user has previously
    // engaged with the domain. Critically, this covers the page-reload
    // case: the user has already logged in, navigated, played a game —
    // they have ample engagement signals. The browser permits eager
    // resume. Audio plays on reload without requiring a click.
    //
    // On iOS Safari and other strict environments, this attempt is
    // either ignored (state stays 'suspended') or quietly rejects. The
    // gesture-based unlock listeners attached above then take over on
    // the first user interaction. Either way, this call is harmless.
    this._tryEagerUnlock()
  }

  // ── _buildBusSpine ─────────────────────────────────────────────────────────
  // Creates the persistent bus graph on this.ctx: master compressor + gain into
  // destination, plus the ambient / synergy / rumble buses feeding master.
  // Called once at construction and again by _rebuildSpine() to rebuild the
  // spine in place. Does NOT create source modules — those live in _buildSources.
  _buildBusSpine() {
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
    // The split lets the bed duck to silence under dysregulation
    // (AMBIENT_BED_FLOOR = 0) while the breath stays audible at 50%
    // (BREATH_DUCK_FLOOR = 0.5). The breath's spectral muffling via
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
    // breath path so the dysregulation experience is "ambient fades to silence;
    // breath stays present, half as loud."
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

    // ── Rumble bus ── starts silent; gaugeEffect drives the level up.
    this.rumbleBus = this.ctx.createGain()
    this.rumbleBus.gain.value = 0
    this.rumbleBus.connect(this.masterGain)
  }

  // ── _tryEagerUnlock ──────────────────────────────────────────────────────
  // Best-effort unlock for browsers that permit autoplay-with-sound on
  // engaged domains. Does the silent-buffer kick + resume(); if the
  // resume actually transitions the context to 'running', flips the
  // _unlocked flag so the visibilitychange handler will manage state
  // across background/foreground transitions.
  _tryEagerUnlock() {
    this._playSilentBuffer()
    const resumePromise = this.ctx.resume()
    // resume() always returns a Promise. We need to check state AFTER
    // it resolves to know if it actually transitioned. If the browser
    // refused, state stays 'suspended' silently — no error to catch.
    if (resumePromise && typeof resumePromise.then === 'function') {
      resumePromise.then(() => {
        if (this.ctx.state === 'running') {
          this._unlocked = true
        }
      }).catch(() => { /* refused — wait for gesture */ })
    }
  }

  // ── _playSilentBuffer ─────────────────────────────────────────────────────
  // The iOS AudioSession engage trick: playing a one-sample silent buffer
  // forces the audio session backing Web Audio to actually start producing
  // output. Used by unlock() and by the visibilitychange handler. Safe to
  // call on a suspended context (the source just queues).
  _playSilentBuffer() {
    try {
      const buf    = this.ctx.createBuffer(1, 1, 22050)
      const source = this.ctx.createBufferSource()
      source.buffer = buf
      source.connect(this.ctx.destination)
      source.start(0)
    } catch (e) {
      // Older browsers may throw if context is closed or buffer args are odd.
    }
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
    // Silent-buffer kick (see _playSilentBuffer). Essential on iOS.
    this._playSilentBuffer()

    // Always attempt resume from inside the gesture — a user gesture is the
    // strongest signal iOS accepts for leaving 'suspended'/'interrupted', and
    // the gesture credit is consumed at call time, not at promise resolution.
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {})
    }

    // If we were backgrounded, advance the recovery state machine from inside
    // the gesture (the strongest signal for leaving 'suspended'/'interrupted').
    // It rebuilds the spine while suspended and the sources once running — never
    // sources-while-suspended, which is what produced the silent failures.
    if (this._needsRecovery && this._started && !this._disposed) {
      this._advanceRecovery()
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

    this._buildSources()

    if (this._muted) return  // user is muted; un-mute will restore via setMuted's ramp
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(targetGain, now)
  }

  // ── _buildSources ───────────────────────────────────────────────────────
  // Creates the source modules (breath, bowl, reverb sends, sampled bed) and
  // connects them to the persistent bus spine. Separated from startAmbient so
  // it can be re-run by _buildSourcesOnRunning() after an iOS interruption kills
  // the source nodes. Does NOT touch master gain — the caller owns that.
  _buildSources() {
    // One-time noise buffer generation (~50ms). Kept across rebuilds.
    if (!this._noiseBufs) {
      this._noiseBufs = createNoiseBuffers(this.ctx)
    }

    const gen = this._buildGen = (this._buildGen || 0) + 1

    //   breath  — inhale/exhale textures locked to breathPhase. Routes
    //             through ambientBus → ambientLowpass → ambientLevel → master.
    //   bowl    — synergy reward, partials fade in stage by stage.
    //   ambient — sampled forest-meadow bed, loaded async, → ambientBedGain.
    //   (rumble is disabled; rumbleBus infrastructure remains for the future.)
    this._breath = createBreath(this.ctx, this._noiseBufs.pink)
    this._breath.output.connect(this.ambientBus)  // dry path

    this._bowl = createBowl(this.ctx)
    this._bowl.output.connect(this.synergyBus)

    // Reverb sends: breath (dry to ambientBus, wet via reverbSend) and bowl
    // (wet via bowlReverbSend off synergyBus) share one reverb → ambientBus.
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

    // synergyBus starts silent; update() ramps it from bowl progress.
    this.synergyBus.gain.value = 0

    // Ambient bed loads asynchronously (fetch + decode; cached after first
    // load). It's a Web Audio buffer source (NOT a media element) so it has no
    // iOS media-session entanglement — no lock-screen track, no pause on
    // headphone removal — and it rebuilds with the other sources on
    // interruption recovery. The `gen` guard drops the result if a dispose or a
    // newer _buildSources (rebuild) happened while this promise was in flight.
    createAmbient(this.ctx)
      .then((ambient) => {
        if (this._disposed || gen !== this._buildGen) {
          ambient.dispose()
          return
        }
        this._ambient = ambient
        ambient.output.connect(this.ambientBedGain)
      })
      .catch((err) => {
        if (typeof window !== 'undefined' && window.Sentry) {
          window.Sentry.captureException(err, { tags: { area: 'ambient-load' } })
        }
      })
  }

  // ── _disposeSources ─────────────────────────────────────────────────────
  // Stops + disconnects the source modules and reverb sends, leaving the
  // persistent bus spine intact. Used by _rebuildSpine, _buildSourcesOnRunning,
  // and dispose.
  _disposeSources() {
    this._breath?.dispose()
    this._rumble?.dispose()
    this._bowl?.dispose()
    this._ambient?.dispose()
    this._reverb?.dispose()
    try { this._reverbSend?.disconnect()     } catch (e) { /* already disconnected */ }
    try { this._bowlReverbSend?.disconnect() } catch (e) { /* already disconnected */ }
    this._breath = this._rumble = this._bowl = this._ambient = null
    this._reverb = this._reverbSend = this._bowlReverbSend = null
  }

  // ── _advanceRecovery ────────────────────────────────────────────────────────
  // The single interruption-recovery driver, shared by the statechange handler,
  // the visibility 'visible' event, the unlock gesture, and the resume pump.
  // Each of those just nudges; THIS method decides what to do based on the live
  // context state, reproducing the exact ordering the known-good exit-and-re-enter
  // path produces:
  //
  //   • rebuild the BUS SPINE while the context is SUSPENDED (not running), then
  //   • build the SOURCE nodes once the context is RUNNING.
  //
  // On-device logs proved this ordering is the whole game (same AudioContext id
  // throughout — the context is NOT poisoned). Of the three combinations seen:
  //   spine@suspended + sources@suspended → silent (sources born dead)
  //   spine@running   + sources@running   → silent (spine never re-bound to output)
  //   spine@suspended + sources@running   → WORKS  (what exit/re-enter does)
  // Rebuilding the master→destination spine while the audio unit is parked
  // (suspended) is what makes the next resume() bind the graph to real output.
  //
  // Idempotent: _spineRebuilt gates the one-time spine rebuild, _needsRecovery
  // gates the one-time source build. Stays a no-op while backgrounded.
  _advanceRecovery() {
    if (!this._needsRecovery || !this._started || this._disposed) return
    if (document.hidden) return  // can't recover a backgrounded page; wait for 'visible'
    const state = this.ctx.state

    if (state === 'interrupted') {
      // Nudge interrupted → suspended (resume() does this on iOS); we rebuild the
      // spine on 'suspended', matching exit/re-enter — never on 'interrupted'.
      this._playSilentBuffer()
      this.ctx.resume().catch(() => {})
      this._startRecoveryPump()
      return
    }

    if (state === 'suspended') {
      if (!this._spineRebuilt) {
        this._rebuildSpine()        // ← the KEY step: spine rebuilt WHILE SUSPENDED
        this._spineRebuilt = true
      }
      // Drive toward running; the sources are built when we get there.
      this._playSilentBuffer()
      this.ctx.resume().catch(() => {})
      this._startRecoveryPump()
      return
    }

    // state === 'running'
    if (this._spineRebuilt) {
      this._buildSourcesOnRunning()  // ← sources built WHILE RUNNING, on the rebuilt spine
      this._needsRecovery = false
      this._spineRebuilt  = false
      this._stopRecoveryPump()
    } else {
      // Reached running before we could rebuild the spine on a suspended context
      // (e.g. iOS auto-resumed). Bounce through suspend so the branch above runs.
      this.ctx.suspend().catch(() => {})
    }
  }

  // ── _rebuildSpine ─────────────────────────────────────────────────────────
  // Disposes the dead sources, disconnects the old (interruption-killed) bus
  // spine, and builds a fresh one — reconnecting masterGain → compressor →
  // ctx.destination. MUST run while the context is NOT running: parking the
  // audio unit (suspended) and rewiring the output path is what lets the next
  // resume() bind the graph to live output. Sources are built separately, after
  // 'running' (see _buildSourcesOnRunning).
  _rebuildSpine() {
    this._disposeSources()
    for (const node of [this.masterGain, this.compressor, this.ambientBus,
                        this.ambientLowpass, this.ambientLevel,
                        this.ambientBedGain, this.synergyBus, this.rumbleBus]) {
      try { node.disconnect() } catch (e) { /* already disconnected */ }
    }
    this._buildBusSpine()
  }

  // ── _buildSourcesOnRunning ──────────────────────────────────────────────────
  // Builds the source modules on the now-running context (so they start on a live
  // clock, not born-dead) and restores master gain. Runs from _advanceRecovery's
  // 'running' branch, after _rebuildSpine has re-bound the output path.
  _buildSourcesOnRunning() {
    this._disposeSources()
    this._buildSources()
    this._lastLowpass        = LOWPASS_OPEN_HZ
    this._lastLevel          = AMBIENT_LEVEL_FULL
    this._lastRumble         = 0
    this._lastSynergy        = 0
    this._lastBreathDuck     = 1
    this._lastAmbientBedDuck = 1
    this._bowlProgress       = 0
    this._lastUpdateAudioTime = null

    if (this._muted) return
    const now = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this._mutedGain, now)
  }

  // ── _startRecoveryPump / _stopRecoveryPump ──────────────────────────────────
  // The automatic, gesture-free engine behind recovery. While a recovery is
  // pending it re-runs _advanceRecovery on a short interval — nudging the context
  // interrupted → suspended → running (rebuilding the spine and then the sources
  // along the way) without needing a user gesture. If iOS refuses a gesture-free
  // resume, the pump keeps trying (capped); the user's next natural touch on the
  // game also calls _advanceRecovery via unlock(). It clears itself once
  // _needsRecovery is satisfied. Note _advanceRecovery re-invokes
  // _startRecoveryPump — the _recoveryTimer guard makes that a no-op, and we set
  // the timer BEFORE the first tick so there's no re-entrant recursion.
  _startRecoveryPump() {
    if (this._disposed || this._recoveryTimer || document.hidden) return
    if (!this._needsRecovery) return
    this._recoveryAttempts = 0
    this._recoveryTimer = setInterval(() => this._pumpTick(), RECOVERY_INTERVAL_MS)
    this._pumpTick()  // immediate first attempt (timer already set ⇒ re-entry no-ops)
  }

  _pumpTick() {
    this._recoveryAttempts++
    if (this._disposed || document.hidden || !this._needsRecovery
        || this._recoveryAttempts > RECOVERY_MAX_ATTEMPTS) {
      this._stopRecoveryPump()
      return
    }
    this._advanceRecovery()
  }

  _stopRecoveryPump() {
    if (!this._recoveryTimer) return
    clearInterval(this._recoveryTimer)
    this._recoveryTimer = null
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
  // Idempotent cleanup for a game session. Stops + disconnects the sources and
  // this director's bus spine, removes lifecycle listeners, and SUSPENDS (does
  // NOT close) the shared AudioContext — the context is an app-lifetime
  // singleton reused by the next game (see getSharedAudioContext). Closing it
  // here would risk the per-page AudioContext limit on repeated entry/exit.
  dispose() {
    this._disposed = true
    this._started  = false
    this._stopRecoveryPump()
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    this.ctx.removeEventListener('statechange', this._onStateChange)
    this._unlockEventTypes?.forEach((ev) => {
      document.removeEventListener(ev, this._unlockListener)
    })
    this._disposeSources()
    try { this.ambientBedGain.disconnect() } catch (e) { /* already disconnected */ }
    try { this.masterGain.disconnect()     } catch (e) { /* already disconnected */ }
    try { this.compressor.disconnect()     } catch (e) { /* already disconnected */ }
    // Suspend (not close) so the singleton context survives for the next game
    // while releasing the audio thread between sessions.
    if (this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {})
    }
  }
}
