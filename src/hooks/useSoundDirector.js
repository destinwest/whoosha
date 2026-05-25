// ── useSoundDirector ───────────────────────────────────────────────────────
// Hook that instantiates a SoundDirector on mount and tears it down on
// unmount. Returns a stable ref-style object whose `.current` is the director.
// Using a ref-shape (instead of returning the director directly) means the
// caller can freely close over it inside event handlers without re-rendering.
//
// Mute preference is wired in here so that consumers don't have to thread it
// through manually — toggling mute anywhere in the app immediately propagates
// to the audio graph.

import { useEffect, useRef } from 'react'
import SoundDirector from '../sound/SoundDirector'
import { useMutePref } from './useMutePref'

export function useSoundDirector() {
  const directorRef = useRef(null)
  const [muted]     = useMutePref()

  // Lazy-init on first render so the AudioContext isn't constructed at module
  // load time (which would block teardown and waste an audio thread for
  // routes that don't use sound).
  if (!directorRef.current) {
    directorRef.current = new SoundDirector()
  }

  // Mirror mute pref into the director whenever it changes.
  useEffect(() => {
    directorRef.current?.setMuted(muted)
  }, [muted])

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      directorRef.current?.dispose()
      directorRef.current = null
    }
  }, [])

  return directorRef
}
