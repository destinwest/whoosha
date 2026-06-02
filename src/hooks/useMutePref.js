// ── useMutePref ────────────────────────────────────────────────────────────
// localStorage-backed mute preference, shared across every component that
// uses the hook. Returns [muted, toggleMute, setMuted].
//
// Architecture note: the previous version used a per-component useState,
// which meant each useMutePref() call had its OWN copy of the muted state.
// MuteButton would update its copy on click, but useSoundDirector's copy
// stayed unchanged (the cross-tab `storage` event only fires for OTHER
// tabs, not the same one). Result: button toggled, audio kept playing.
//
// This version uses useSyncExternalStore with a module-scope source of
// truth. All hook callers see the same value; any update notifies every
// subscriber. Cross-tab sync via the `storage` event still works.

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'whoosha.audio.muted'

function readInitial() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (e) {
    // localStorage can throw in private-browsing modes / cross-origin frames.
    return false
  }
}

// ── Module-scope state ──
// One source of truth shared by every useMutePref() consumer in the app.
let currentValue   = readInitial()
const subscribers  = new Set()

function notifyAll() {
  subscribers.forEach((cb) => cb())
}

// ── Module-scope storage listener ──
// Cross-tab sync: another tab toggling mute updates this tab's value and
// re-renders every subscriber. One listener for the whole module; per-
// component subscribe() adds/removes from the subscriber set only.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    const next = e.newValue === 'true'
    if (next === currentValue) return
    currentValue = next
    notifyAll()
  })
}

function setValue(value) {
  if (value === currentValue) return
  currentValue = value
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  } catch (e) {
    // Silently fail — in-memory state still works for this session.
  }
  notifyAll()
}

// ── useSyncExternalStore plumbing ──
function subscribe(callback) {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}

function getSnapshot() {
  return currentValue
}

function getServerSnapshot() {
  return false  // SSR default — no localStorage available there
}

// ── Hook ──
export function useMutePref() {
  const muted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setMuted   = useCallback((value) => setValue(value), [])
  const toggleMute = useCallback(() => setValue(!currentValue), [])
  return [muted, toggleMute, setMuted]
}
