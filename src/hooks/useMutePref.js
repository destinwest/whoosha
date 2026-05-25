// ── useMutePref ────────────────────────────────────────────────────────────
// localStorage-backed mute preference. Returns [muted, toggleMute, setMuted].
// Mute state persists across sessions and tabs (storage event sync).
//
// Why localStorage and not Zustand? The preference is purely client-side, has
// no server contract, and needs to be readable before the React tree mounts
// (so the initial render of MuteButton shows the correct state). localStorage
// satisfies all three with zero infrastructure. When/if a Supabase-synced
// user-prefs object exists, this hook can shadow-write to it.

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'whoosha.audio.muted'

function readInitial() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (e) {
    // localStorage can throw in private-browsing modes / cross-origin frames.
    return false
  }
}

function writePref(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  } catch (e) {
    // Silently fail — the in-memory state still works for this session.
  }
}

export function useMutePref() {
  const [muted, setMutedState] = useState(readInitial)

  // Cross-tab sync: another tab toggling mute should propagate here.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== STORAGE_KEY) return
      setMutedState(e.newValue === 'true')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setMuted = useCallback((value) => {
    setMutedState(value)
    writePref(value)
  }, [])

  const toggleMute = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev
      writePref(next)
      return next
    })
  }, [])

  return [muted, toggleMute, setMuted]
}
