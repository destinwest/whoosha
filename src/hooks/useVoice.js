// ── useVoice ─────────────────────────────────────────────────────────────────
// Game-agnostic spoken-cue path — the generalization of the original
// Star-only voice hook. Builds a per-game node graph (master gain → destination) on the
// app's shared AudioContext, plays cues from the globally-selected voice pack
// (useVoicePref), honours the shared mute pref, and tears down on unmount
// WITHOUT touching the shared context. Rebuilds when the selected voice changes
// (re-decodes the new pack).
//
// Returns a stable ref whose `.current` exposes:
//   unlock()    — resume the context on the first user gesture (iOS). Idempotent.
//   play(kind)  — fire 'in' | 'out' | 'hold' | 'intro'. Returns true if it
//                 started, false if skipped (context not running, clip not
//                 loaded / not in this pack) — callers retry next frame.
//   stop()      — quick-fade any in-flight cue (call on exit).

import { useEffect, useRef } from 'react'
import { createVoice } from '../sound/voice'
import { VOICES, resolveVoiceId } from '../sound/voices'
import { getSharedAudioContext } from '../sound/sharedContext'
import { useMutePref } from './useMutePref'
import { useVoicePref } from './useVoicePref'

const MASTER_GAIN = 0.9

export function useVoice() {
  const ref      = useRef({ unlock() {}, play() { return false }, stop() {} })
  const mutedRef = useRef(false)
  const [muted]  = useMutePref()
  const [voiceId] = useVoicePref()

  // Rebuild the graph when the selected voice changes (new clip set).
  useEffect(() => {
    let ctx, voice, master
    let disposed = false

    try {
      ctx = getSharedAudioContext()
      ctx.resume().catch(() => {})
      master = ctx.createGain()
      master.gain.value = mutedRef.current ? 0 : MASTER_GAIN
      master.connect(ctx.destination)
      voice = createVoice(ctx, VOICES[resolveVoiceId(voiceId)].clips)
      voice.output.connect(master)
    } catch (e) {
      return   // audio unavailable — keep the no-op api
    }

    ref.current = {
      unlock() {
        // `!== 'running'` so iOS's 'interrupted' state is also driven back.
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
      },
      play(kind) {
        if (disposed || ctx.state !== 'running') return false
        return voice.play(kind)
      },
      stop() { if (!disposed) voice.stop() },
      setMuted(m) {
        master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02)
      },
    }

    return () => {
      disposed = true
      try { voice.dispose() }     catch (e) {}
      try { master.disconnect() } catch (e) {}
      ref.current = { unlock() {}, play() { return false }, stop() {} }
    }
  }, [voiceId])

  // Mirror the shared mute pref into the master gain.
  useEffect(() => {
    mutedRef.current = muted
    ref.current.setMuted?.(muted)
  }, [muted])

  return ref
}
