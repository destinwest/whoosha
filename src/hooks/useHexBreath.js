// ── useHexBreath ───────────────────────────────────────────────────────────
// BREATH + AMBIENT-BED audio path for the Hexagon game. Deliberately NOT the
// full SoundDirector: no bowl, no rumble, no reverb sends. Just an
// AudioContext, the noise buffers, the hex breath module, and the sampled
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
//      whenever the breath texture is swelling, so a deliberately deep/quiet
//      breath (brown noise, heavily low-passed — see synthHexBreath.js) can
//      still read clearly against a broadband sampled ambient track instead
//      of being masked by it. Driven directly by synthHexBreath's own bell
//      envelope (returned from `update()`), so it's always in lockstep with
//      whatever the breath is actually doing — no separate timing model.
//
// Returns a stable ref whose `.current` exposes:
//   unlock()               — resume the context; call on the first user
//                            gesture (required on iOS). Idempotent.
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
// Everything is created in a mount effect and fully torn down on unmount.

import { useEffect, useRef } from 'react'
import { createNoiseBuffers } from '../sound/noiseBuffer'
import { createHexBreath }    from '../sound/synthHexBreath'
import { createHexAmbient }   from '../sound/synthHexAmbient'
import { useMutePref }        from './useMutePref'

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
// (TC_ENV = 0.03 in synthHexBreath.js) so the duck reads as the bed gently
// making room, not chasing the breath's every micro-movement.
const BED_BREATH_DUCK_FLOOR = 0.55
const TC_BREATH_DUCK        = 0.25

export function useHexBreath() {
  const ref      = useRef({ unlock() {}, update() {}, updateGauge() {}, fadeOut() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()

  useEffect(() => {
    let ctx, breath, master, ambientBedGain, ambientBreathDuck
    let ambient  = null   // populated once createHexAmbient resolves
    let disposed = false
    let lastBedDuck    = 1
    let lastBreathDuck = 1

    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx    = new AC()
      const bufs = createNoiseBuffers(ctx)   // ~50ms once; generates pink + brown
      master = ctx.createGain()
      master.gain.value = mutedRef.current ? 0 : MASTER_GAIN
      master.connect(ctx.destination)

      breath = createHexBreath(ctx, bufs)
      breath.output.connect(master)

      // Ambient bed lives on its own gain chain, separate from the breath —
      // so neither duck below ever touches the breath's own gain. Two gain
      // nodes in series: gauge duck, then breath-presence duck, then master.
      // Loads async; connects once ready (or is immediately disposed if
      // we've already torn down).
      ambientBedGain    = ctx.createGain()
      ambientBedGain.gain.value = 1
      ambientBreathDuck = ctx.createGain()
      ambientBreathDuck.gain.value = 1
      ambientBedGain.connect(ambientBreathDuck)
      ambientBreathDuck.connect(master)

      createHexAmbient(ctx)
        .then((mod) => {
          if (disposed) { try { mod.dispose() } catch (e) {}; return }
          ambient = mod
          ambient.output.connect(ambientBedGain)
        })
        .catch(() => {})   // ambient bed unavailable — breath still plays
    } catch (e) {
      return   // audio unavailable — leave the no-op api in place
    }

    ref.current = {
      unlock() {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      },
      update(fraction) {
        if (disposed || ctx.state !== 'running') return
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
      try { breath.dispose() }            catch (e) {}
      try { ambient?.dispose() }          catch (e) {}
      try { ambientBedGain.disconnect() }    catch (e) {}
      try { ambientBreathDuck.disconnect() } catch (e) {}
      try { master.disconnect() }         catch (e) {}
      try { ctx.close() }                 catch (e) {}
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
