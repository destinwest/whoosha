// ── useSpokenCues ────────────────────────────────────────────────────────────
// Shared spoken-cue driver for a game: owns the voice (useVoice), the per-game
// spokenCues gate (useSettings) and the edge-detection, so a game only has to
// report "the breath is now in phase <key>, whose cue is <cue>" every frame.
// A cue fires once per phase change — the same signal the written labels use,
// so it is in sync with any game's rhythm by construction.
//
//   const cues = useSpokenCues('triangle', phase === 'game')
//   cues.emit(key, cue)  — call per frame. `key` identifies the phase instance
//                          (changes ⇒ new phase); `cue` is 'in' | 'out' | 'hold'
//                          (or null for a silent phase).
//   cues.unlock()        — resume audio on a user gesture (iOS fallback).
//   cues.stop()          — quick-fade any in-flight cue (call on exit).
//
// Behaviour: while spoken cues are off the phase is still tracked, so turning
// them on waits for the next transition instead of speaking mid-breath. A cue
// that could not start (context not running / clip still decoding) is retried
// on the following frames. `skipFirst` swallows the phase the game mounts into
// — for games that start part-way through a phase (Square opens in a hold).
//
// The returned object is stable, so it is safe inside once-created callbacks.

import { useRef } from 'react'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'

export function useSpokenCues(gameKey, active = true, { skipFirst = false } = {}) {
  const { settings } = useSettings(gameKey)
  const voiceRef  = useVoice()
  const spokenRef = useRef(settings.spokenCues)
  spokenRef.current = settings.spokenCues
  const activeRef = useRef(active)
  activeRef.current = active
  const lastKeyRef = useRef(undefined)
  const firstRef   = useRef(skipFirst)

  return useRef({
    emit(key, cue) {
      if (!activeRef.current || key === lastKeyRef.current) return
      if (firstRef.current) { firstRef.current = false; lastKeyRef.current = key; return }
      if (!spokenRef.current || !cue) { lastKeyRef.current = key; return }
      if (voiceRef.current?.play(cue)) lastKeyRef.current = key
    },
    unlock() { voiceRef.current?.unlock() },
    stop()   { voiceRef.current?.stop() },
  }).current
}
