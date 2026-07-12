// ── useStarVoice ───────────────────────────────────────────────────────────
// Minimal, VOICE-ONLY audio path for the Star game — spoken "breathe in" /
// "breathe out" cues via starVoice.js. Deliberately NOT the full SoundDirector
// (no ambient bed, no bowl, no rumble, no dysregulation) — mirrors
// useHexBreath.js: its own AudioContext, closed on unmount, honouring the
// shared mute preference.
//
// Returns a stable ref whose `.current` exposes:
//   unlock()       — resume the context; call on the first user gesture
//                    (required on iOS). Idempotent.
//   play(kind)     — fire the 'in' | 'out' cue. No-op until the context is
//                    running and the clips have decoded.
//   stop()         — immediately quick-fade any in-flight cue. Call when the
//                    game exits to the completion screen.
//
// Everything is created in a mount effect and fully torn down on unmount.

import { useEffect, useRef } from 'react'
import { createStarVoice } from '../sound/starVoice'
import { useMutePref }     from './useMutePref'

const MASTER_GAIN = 0.9

export function useStarVoice() {
  const ref      = useRef({ unlock() {}, play() {}, stop() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()

  useEffect(() => {
    let ctx, voice, master
    let disposed = false

    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx    = new AC()
      master = ctx.createGain()
      master.gain.value = mutedRef.current ? 0 : MASTER_GAIN
      master.connect(ctx.destination)
      voice = createStarVoice(ctx)
      voice.output.connect(master)
    } catch (e) {
      return   // audio unavailable — leave the no-op api in place
    }

    ref.current = {
      unlock() {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      },
      play(kind) {
        if (!disposed && ctx.state === 'running') voice.play(kind)
      },
      stop() {
        if (!disposed) voice.stop()
      },
      setMuted(m) {
        master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02)
      },
    }

    return () => {
      disposed = true
      try { voice.dispose() }    catch (e) {}
      try { master.disconnect() } catch (e) {}
      try { ctx.close() }        catch (e) {}
      ref.current = { unlock() {}, play() {}, stop() {} }
    }
  }, [])

  // Mirror the shared mute pref into the master gain.
  useEffect(() => {
    mutedRef.current = muted
    ref.current.setMuted?.(muted)
  }, [muted])

  return ref
}
