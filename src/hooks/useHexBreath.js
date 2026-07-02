// ── useHexBreath ───────────────────────────────────────────────────────────
// Minimal, BREATH-ONLY audio path for the Hexagon game — an audition rig for
// synthHexBreath.js. Deliberately NOT the full SoundDirector: no ambient bed,
// no bowl, no rumble, no dysregulation. Just an AudioContext, the noise
// buffers, and the hex breath module routed to the speakers through a master
// gain (which also honours the shared mute preference).
//
// Returns a stable ref whose `.current` exposes:
//   unlock()          — resume the context; call on the first user gesture
//                       (required on iOS). Idempotent.
//   update(fraction)  — drive the breath with the pacing fraction [0,6) each
//                       frame. No-op until the context is running.
//
// Everything is created in a mount effect and fully torn down on unmount.

import { useEffect, useRef } from 'react'
import { createNoiseBuffers } from '../sound/noiseBuffer'
import { createHexBreath }    from '../sound/synthHexBreath'
import { useMutePref }        from './useMutePref'

const MASTER_GAIN = 0.9

export function useHexBreath() {
  const ref      = useRef({ unlock() {}, update() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()

  useEffect(() => {
    let ctx, breath, master
    let disposed = false

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
    } catch (e) {
      return   // audio unavailable — leave the no-op api in place
    }

    ref.current = {
      unlock() {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      },
      update(fraction) {
        if (!disposed && ctx.state === 'running') breath.update(fraction)
      },
      setMuted(m) {
        master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02)
      },
    }

    return () => {
      disposed = true
      try { breath.dispose() }   catch (e) {}
      try { master.disconnect() } catch (e) {}
      try { ctx.close() }        catch (e) {}
      ref.current = { unlock() {}, update() {} }
    }
  }, [])

  // Mirror the shared mute pref into the master gain.
  useEffect(() => {
    mutedRef.current = muted
    ref.current.setMuted?.(muted)
  }, [muted])

  return ref
}
