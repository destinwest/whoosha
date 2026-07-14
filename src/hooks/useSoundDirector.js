// ── useSoundDirector ───────────────────────────────────────────────────────
// Hook that instantiates a SoundDirector on mount and tears it down on
// unmount. Returns a stable ref-style object whose `.current` is the director.
// Using a ref-shape (instead of returning the director directly) means the
// caller can freely close over it inside event handlers without re-rendering.
//
// The director is created inside the mount effect — NOT lazily during render —
// so the hook survives React 18 StrictMode's dev-only mount→unmount→remount
// cycle. The previous render-time lazy init left `directorRef.current` null
// after the simulated unmount (cleanup nulled it, and no render runs between
// cleanup and the remounted effects), so a consumer's own mount effect (e.g.
// SquareGame's `startAmbient` on [phase]) fired against a null ref and audio
// never started in dev. Creating in the effect matches the useHexBreath /
// useStarVoice shape: every mount pass gets a live instance.
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

  // Mirror the latest mute pref into a ref so the mount effect below can
  // apply it to a freshly-created director without depending on `muted`
  // (which would tear down the director on every mute toggle).
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  // Create on mount, tear down on unmount. Registered before any consumer
  // effect (hooks run in call order), so by the time a consumer's own mount
  // effect runs, `directorRef.current` is live.
  useEffect(() => {
    const director = new SoundDirector()
    director.setMuted(mutedRef.current)
    directorRef.current = director
    return () => {
      director.dispose()
      if (directorRef.current === director) directorRef.current = null
    }
  }, [])

  // Mirror mute pref into the director whenever it changes.
  useEffect(() => {
    directorRef.current?.setMuted(muted)
  }, [muted])

  return directorRef
}
