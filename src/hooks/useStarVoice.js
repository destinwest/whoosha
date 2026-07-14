// ── useStarVoice ───────────────────────────────────────────────────────────
// Minimal, VOICE-ONLY audio path for the Star game — spoken "breathe in" /
// "breathe out" / intro cues via starVoice.js. Deliberately NOT the full
// SoundDirector (no ambient bed, no bowl, no rumble, no dysregulation) —
// mirrors useHexBreath.js: a per-game node graph on the app's shared
// AudioContext (see sharedContext.js), torn down on unmount, honouring the
// shared mute preference.
//
// Returns a stable ref whose `.current` exposes:
//   unlock()       — resume the context; call on the first user gesture
//                    (required on iOS). Idempotent.
//   play(kind)     — fire the 'in' | 'out' | 'intro' cue. Returns true if it
//                    actually started, false if skipped (context not yet
//                    running, or the clip hasn't finished decoding) — callers
//                    use this to retry on the next frame instead of silently
//                    losing the cue.
//   stop()         — immediately quick-fade any in-flight cue. Call when the
//                    game exits to the completion screen.
//
// Everything is created in a mount effect and fully torn down on unmount.

import { useEffect, useRef } from 'react'
import { createStarVoice } from '../sound/starVoice'
import { getSharedAudioContext } from '../sound/sharedContext'
import { useMutePref }     from './useMutePref'

const MASTER_GAIN = 0.9

export function useStarVoice() {
  const ref      = useRef({ unlock() {}, play() { return false }, stop() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()

  useEffect(() => {
    let ctx, voice, master
    let disposed = false

    try {
      // App-lifetime shared context (see sharedContext.js) — unlocked by the
      // home carousel's card tap, so on iOS the intro clip can start at mount
      // with no in-game touch. The gesture-free resume is a no-op when the
      // context is already running and harmless when refused.
      ctx = getSharedAudioContext()
      ctx.resume().catch(() => {})
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
        // `!== 'running'` (not `=== 'suspended'`) so the iOS-only
        // 'interrupted' state is also driven back toward running.
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
      },
      play(kind) {
        if (disposed || ctx.state !== 'running') return false
        return voice.play(kind)
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
      // Do NOT close or suspend the shared context — it's the app-lifetime
      // singleton shared by every game (see sharedContext.js).
      ref.current = { unlock() {}, play() { return false }, stop() {} }
    }
  }, [])

  // Mirror the shared mute pref into the master gain.
  useEffect(() => {
    mutedRef.current = muted
    ref.current.setMuted?.(muted)
  }, [muted])

  return ref
}
