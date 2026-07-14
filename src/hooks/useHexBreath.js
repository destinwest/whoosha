// ── useHexBreath ───────────────────────────────────────────────────────────
// BREATH + AMBIENT-BED audio path for the Hexagon game. Deliberately NOT the
// full SoundDirector: no bowl, no rumble, no reverb sends. Just the app's
// shared AudioContext, the noise buffers, the hex breath module, and the sampled
// ambient bed (synthHexAmbient) — routed to the speakers through a master
// gain (which also honours the shared mute preference).
//
// The ambient bed ducks in two independent ways, chained in series (each is
// its own gain node so either can attenuate the bed without touching the
// other's bookkeeping):
//   1. Heat-gauge duck — toward silence as the gauge climbs, mirroring
//      SoundDirector's dysregulation treatment of Square's ambient bed: same
//      lpRatio/TC_LEVEL/RESCHEDULE_EPS constants, same "duck the bed's own
//      gain node, leave the breath alone" shape. Scoped to just the bed (no
//      lowpass sweep, no breath duck, no rumble/synergy) since Hexagon has
//      none of those other modules.
//   2. Breath-presence duck (sidechain) — the bed steps back a little
//      whenever the breath texture is swelling, so the deliberately soft
//      breath (see synthHexBreath.js) can still read clearly against a
//      broadband sampled ambient track instead of being masked by it. Driven
//      directly by synthHexBreath's own bell envelope (returned from
//      `update()`), so it's always in lockstep with whatever the breath is
//      actually doing — no separate timing model.
//
// ── iOS lock/unlock interruption recovery ──
// A phone lock (or another app grabbing the audio session) kills BOTH the
// playing source nodes AND the graph's binding to ctx.destination; resume()
// restores the context clock but not the dead graph. This hook ports the
// recovery machine proven on-device in SoundDirector (see _advanceRecovery
// there for the on-device log evidence): rebuild the SPINE (master + duck
// gains → destination) while the context is SUSPENDED, then rebuild the
// SOURCES (breath synth + ambient bed) once it is RUNNING — never sources
// while suspended (born dead), never spine while running (never re-binds).
// Keyed on visibilitychange→hidden (the reliable signal; iOS does not
// reliably emit 'interrupted'), driven by a gesture-free resume pump plus
// the unlock() gesture as fallback.
//
// Returns a stable ref whose `.current` exposes:
//   unlock()               — resume the context; call on the first user
//                            gesture (required on iOS). Idempotent. Also
//                            advances interruption recovery.
//   update(fraction)       — drive the breath with the pacing fraction [0,6)
//                            each frame. No-op until the context is running.
//   updateGauge(gaugeFx)   — duck the ambient bed toward silence as the heat
//                            gauge (0..1) climbs. Call once per frame from
//                            HexagonCanvas's onGameStateTick. No-op until the
//                            ambient bed has finished loading.
//   fadeOut(seconds)       — linearly ramp the master gain to 0 over
//                            `seconds`. Same pattern as SoundDirector.fadeOut
//                            — cancels any scheduled gain automation first so
//                            it's safe to call mid-ramp. Fades breath AND
//                            ambient together since both route through
//                            master. Used on game exit.
//
// Everything is created in a mount effect and fully torn down on unmount —
// except the shared AudioContext itself, which is the app-lifetime singleton
// (see sharedContext.js) and is never closed or suspended by this cleanup.

import { useEffect, useRef } from 'react'
import { createNoiseBuffers } from '../sound/noiseBuffer'
import { createHexBreath }    from '../sound/synthHexBreath'
import { createHexAmbient }   from '../sound/synthHexAmbient'
import { getSharedAudioContext, playSilentBuffer } from '../sound/sharedContext'
import { useMutePref }        from './useMutePref'

// Noise buffers are pure AudioBuffers on the app-lifetime shared context —
// generate once (~50ms) and reuse across every Hexagon session.
let _noiseBufs = null

const MASTER_GAIN = 0.9

// ── Dysregulation ducking (ambient bed only) ────────────────────────────────
// Mirrors SoundDirector's ambient-bed duck exactly: same gauge normalization,
// same floor (bed ducks fully to silence), same smoothing time-constant and
// reschedule threshold — see SoundDirector.js's `update()` for the reference.
const GAUGE_DUCK_DIVISOR = 0.9    // gauge/0.9 clamped to 1 — matches SoundDirector's lpRatio
const AMBIENT_BED_FLOOR  = 0.0    // bed ducks fully to silence at max dysregulation
const TC_LEVEL           = 0.10   // setTargetAtTime smoothing constant (s)
const RESCHEDULE_EPS     = 0.005  // skip tiny gain rewrites

// ── Breath-presence duck (sidechain, ambient bed only) ──────────────────────
// Bed multiplies down to BED_BREATH_DUCK_FLOOR at full breath presence (bell
// value 1), back to 1 (no duck) when the breath is silent (holds, or between
// swells). TC_BREATH_DUCK is slower than the breath's own envelope smoothing
// (TC_ENV in synthHexBreath.js) so the duck reads as the bed gently making
// room, not chasing the breath's every micro-movement.
const BED_BREATH_DUCK_FLOOR = 0.55
const TC_BREATH_DUCK        = 0.25

// ── Interruption recovery pump ── (same constants as SoundDirector)
const RECOVERY_INTERVAL_MS  = 400
const RECOVERY_MAX_ATTEMPTS = 40   // ~16s of gesture-free retrying while visible

export function useHexBreath() {
  const ref      = useRef({ unlock() {}, update() {}, updateGauge() {}, fadeOut() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()

  useEffect(() => {
    let ctx
    let disposed = false

    // Live graph handles — rebuilt in place by the recovery machine, so every
    // api closure below reads these outer bindings rather than capturing a
    // node instance that an interruption may have killed.
    let master, ambientBedGain, ambientBreathDuck
    let breath   = null
    let ambient  = null
    let buildGen = 0     // generation guard for the async ambient load
    let lastBedDuck    = 1
    let lastBreathDuck = 1

    // Recovery state (see the header comment). needsRecovery is set on
    // backgrounding; spineRebuilt gates the one-time suspended-state spine
    // rebuild within a recovery cycle.
    let needsRecovery    = false
    let spineRebuilt     = false
    let recoveryTimer    = null
    let recoveryAttempts = 0

    // ── Graph builders / disposers ──────────────────────────────────────────
    // Spine: master + the two bed-duck gains, bound to ctx.destination. MUST
    // be (re)built while the context is NOT running during recovery — that is
    // what lets the next resume() bind the graph to live output.
    function buildSpine() {
      master = ctx.createGain()
      master.gain.value = mutedRef.current ? 0 : MASTER_GAIN
      master.connect(ctx.destination)

      ambientBedGain    = ctx.createGain()
      ambientBedGain.gain.value = 1
      ambientBreathDuck = ctx.createGain()
      ambientBreathDuck.gain.value = 1
      ambientBedGain.connect(ambientBreathDuck)
      ambientBreathDuck.connect(master)
      lastBedDuck    = 1
      lastBreathDuck = 1
    }

    function disposeSpine() {
      for (const node of [ambientBedGain, ambientBreathDuck, master]) {
        try { node?.disconnect() } catch (e) { /* already disconnected */ }
      }
    }

    // Sources: the breath synth (loops noise buffers — killed by an iOS lock)
    // and the async-loading sampled bed. Built at mount and again by recovery
    // once the context is running (sources built on a suspended context are
    // born dead on iOS).
    function buildSources() {
      const gen = ++buildGen
      breath = createHexBreath(ctx, _noiseBufs)
      breath.output.connect(master)

      // The `gen` guard drops the result if a dispose or a newer buildSources
      // (recovery rebuild) happened while the fetch/decode was in flight.
      createHexAmbient(ctx)
        .then((mod) => {
          if (disposed || gen !== buildGen) { try { mod.dispose() } catch (e) {}; return }
          ambient = mod
          ambient.output.connect(ambientBedGain)
        })
        .catch(() => {})   // ambient bed unavailable — breath still plays
    }

    function disposeSources() {
      try { breath?.dispose() }  catch (e) {}
      try { ambient?.dispose() } catch (e) {}
      breath  = null
      ambient = null
      buildGen++   // orphan any in-flight ambient load
    }

    // ── Recovery machine ── (ordering proven on-device for SoundDirector:
    // spine@suspended + sources@running is the only combination that makes
    // audio audible again after an iOS lock/unlock.)
    function advanceRecovery() {
      if (!needsRecovery || disposed) return
      if (document.hidden) return   // can't recover a backgrounded page; wait for 'visible'
      const state = ctx.state

      if (state === 'interrupted') {
        // Nudge interrupted → suspended; the spine is rebuilt on 'suspended'.
        playSilentBuffer(ctx)
        ctx.resume().catch(() => {})
        startRecoveryPump()
        return
      }

      if (state === 'suspended') {
        if (!spineRebuilt) {
          disposeSources()
          disposeSpine()
          buildSpine()          // ← the KEY step: spine rebuilt WHILE SUSPENDED
          spineRebuilt = true
        }
        playSilentBuffer(ctx)
        ctx.resume().catch(() => {})
        startRecoveryPump()
        return
      }

      // state === 'running'
      if (spineRebuilt) {
        disposeSources()
        buildSources()          // ← sources built WHILE RUNNING, on the rebuilt spine
        needsRecovery = false
        spineRebuilt  = false
        stopRecoveryPump()
      } else {
        // Reached running before the spine could be rebuilt on a suspended
        // context (e.g. iOS auto-resumed). Bounce through suspend so the
        // branch above runs.
        ctx.suspend().catch(() => {})
      }
    }

    function startRecoveryPump() {
      if (disposed || recoveryTimer || document.hidden || !needsRecovery) return
      recoveryAttempts = 0
      recoveryTimer = setInterval(pumpTick, RECOVERY_INTERVAL_MS)
      pumpTick()   // immediate first attempt (timer already set ⇒ re-entry no-ops)
    }

    function pumpTick() {
      recoveryAttempts++
      if (disposed || document.hidden || !needsRecovery
          || recoveryAttempts > RECOVERY_MAX_ATTEMPTS) {
        stopRecoveryPump()
        return
      }
      advanceRecovery()
    }

    function stopRecoveryPump() {
      if (!recoveryTimer) return
      clearInterval(recoveryTimer)
      recoveryTimer = null
    }

    // ── Lifecycle listeners ──────────────────────────────────────────────────
    // visibilitychange→hidden is the RELIABLE "sources are about to die"
    // signal on iOS (a lock often never surfaces 'interrupted'). Desktop tab
    // switches take the same path — a harmless source restart on return.
    const onVisibilityChange = () => {
      if (disposed) return
      if (document.hidden) {
        needsRecovery = true
        spineRebuilt  = false
        stopRecoveryPump()
        if (ctx.state === 'running') {
          ctx.suspend().catch(() => {})
        }
        return
      }
      advanceRecovery()
    }

    const onStateChange = () => {
      if (disposed) return
      if (ctx.state === 'interrupted') {
        needsRecovery = true
        spineRebuilt  = false
      }
      advanceRecovery()
    }

    // ── Init ────────────────────────────────────────────────────────────────
    try {
      // App-lifetime shared context (see sharedContext.js) — the home
      // carousel's card tap unlocks it inside the tap gesture, so on iOS the
      // game usually mounts with a context that is already running and the
      // bed + breath are audible with no in-game touch. The gesture-free
      // resume below is a no-op when already running and harmless when
      // refused.
      ctx = getSharedAudioContext()
      ctx.resume().catch(() => {})
      if (!_noiseBufs) _noiseBufs = createNoiseBuffers(ctx)
      buildSpine()
      buildSources()
      document.addEventListener('visibilitychange', onVisibilityChange)
      ctx.addEventListener('statechange', onStateChange)
    } catch (e) {
      return   // audio unavailable — leave the no-op api in place
    }

    ref.current = {
      unlock() {
        // Silent-buffer kick + resume from inside the gesture — the strongest
        // signal iOS accepts for leaving 'suspended'/'interrupted' — then let
        // the recovery machine rebuild the graph if we were backgrounded.
        playSilentBuffer(ctx)
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
        advanceRecovery()
      },
      update(fraction) {
        if (disposed || ctx.state !== 'running' || !breath) return
        const presence = breath.update(fraction)   // 0..1 raw bell value
        if (ambientBreathDuck) {
          const now    = ctx.currentTime
          const target = 1 + (BED_BREATH_DUCK_FLOOR - 1) * presence
          if (Math.abs(target - lastBreathDuck) > RESCHEDULE_EPS) {
            ambientBreathDuck.gain.setTargetAtTime(target, now, TC_BREATH_DUCK)
            lastBreathDuck = target
          }
        }
      },
      updateGauge(gaugeEffect) {
        if (disposed || !ambientBedGain) return
        const now     = ctx.currentTime
        const lpRatio = Math.min(Math.max(gaugeEffect, 0) / GAUGE_DUCK_DIVISOR, 1)
        const target  = 1 + (AMBIENT_BED_FLOOR - 1) * lpRatio
        if (Math.abs(target - lastBedDuck) > RESCHEDULE_EPS) {
          ambientBedGain.gain.setTargetAtTime(target, now, TC_LEVEL)
          lastBedDuck = target
        }
      },
      setMuted(m) {
        master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02)
      },
      fadeOut(seconds = 2.0) {
        const now = ctx.currentTime
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(master.gain.value, now)
        master.gain.linearRampToValueAtTime(0, now + Math.max(0.01, seconds))
      },
    }

    return () => {
      disposed = true
      stopRecoveryPump()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      ctx.removeEventListener('statechange', onStateChange)
      disposeSources()
      disposeSpine()
      // Do NOT close or suspend the shared context — it's the app-lifetime
      // singleton (closing it would count against iOS's per-page context cap,
      // and suspending here would undo the card-tap unlock during StrictMode's
      // dev remount). All of this game's nodes are stopped/disconnected above.
      ref.current = { unlock() {}, update() {}, updateGauge() {}, fadeOut() {} }
    }
  }, [])

  // Mirror the shared mute pref into the master gain.
  useEffect(() => {
    mutedRef.current = muted
    ref.current.setMuted?.(muted)
  }, [muted])

  return ref
}
