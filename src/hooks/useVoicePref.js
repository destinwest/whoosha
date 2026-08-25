// ── useVoicePref ─────────────────────────────────────────────────────────────
// Global selected-voice preference, shared across every consumer — the audio
// counterpart to useMutePref. One voice applies wherever spoken cues are on
// (voice is a GLOBAL choice; whether a given game speaks is its per-game
// spokenCues setting). Module-scope source of truth + useSyncExternalStore, so
// the panel picker and each game's useVoice agree instantly; cross-tab via the
// `storage` event. Returns [voiceId, setVoiceId].

import { useCallback, useSyncExternalStore } from 'react'
import { resolveVoiceId, DEFAULT_VOICE } from '../sound/voices'

const STORAGE_KEY = 'whoosha.audio.voice'

function readInitial() {
  try {
    return resolveVoiceId(localStorage.getItem(STORAGE_KEY))
  } catch (e) {
    return DEFAULT_VOICE
  }
}

let currentValue  = readInitial()
const subscribers = new Set()

function notifyAll() { subscribers.forEach((cb) => cb()) }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    const next = resolveVoiceId(e.newValue)
    if (next === currentValue) return
    currentValue = next
    notifyAll()
  })
}

function setValue(id) {
  const next = resolveVoiceId(id)
  if (next === currentValue) return
  currentValue = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch (e) { /* in-memory still works */ }
  notifyAll()
}

function subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb) }
function getSnapshot() { return currentValue }
function getServerSnapshot() { return DEFAULT_VOICE }

export function useVoicePref() {
  const voiceId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setVoice = useCallback((id) => setValue(id), [])
  return [voiceId, setVoice]
}
