// ── MuteButton ─────────────────────────────────────────────────────────────
// Speaker / speaker-muted toggle. Position-agnostic — the parent decides
// placement via className.
//
// ── Silent-switch hint ──
// On iOS, the device's hardware silent switch overrides Web Audio output.
// Users who can't hear audio often pound the mute button, thinking the
// app is broken. After 4 toggles within 3 seconds, we surface a brief
// hint reminding them to check the device's silent mode. Self-dismissing
// after ~5.5s; tappable to dismiss earlier.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutePref } from '../../hooks/useMutePref'

const SILENT_HINT_TOGGLES     = 4
const SILENT_HINT_WINDOW_MS   = 3000
const SILENT_HINT_DURATION_MS = 5500

export default function MuteButton({ className = '' }) {
  const [muted, toggleMute] = useMutePref()
  const [showHint, setShowHint] = useState(false)
  const clickTimestampsRef = useRef([])
  const hintTimeoutRef     = useRef(null)

  const handleClick = useCallback(() => {
    toggleMute()
    const now = Date.now()
    const timestamps = clickTimestampsRef.current
    timestamps.push(now)
    // Keep only the recent ones inside the detection window.
    while (timestamps.length > 0 && timestamps[0] < now - SILENT_HINT_WINDOW_MS) {
      timestamps.shift()
    }
    if (timestamps.length >= SILENT_HINT_TOGGLES) {
      setShowHint(true)
      clickTimestampsRef.current = []  // reset so the next click doesn't immediately retrigger
      clearTimeout(hintTimeoutRef.current)
      hintTimeoutRef.current = setTimeout(() => setShowHint(false), SILENT_HINT_DURATION_MS)
    }
  }, [toggleMute])

  useEffect(() => () => clearTimeout(hintTimeoutRef.current), [])

  return (
    <>
      <button
        onClick={handleClick}
        className={`w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30 transition-colors ${className}`}
        aria-label={muted ? 'Unmute audio' : 'Mute audio'}
        aria-pressed={muted}
      >
        {muted ? (
          // Speaker with diagonal slash
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          // Speaker with two sound waves
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      {showHint && (
        <div
          onClick={() => setShowHint(false)}
          role="status"
          className="fixed top-20 right-4 z-50 max-w-[18rem] bg-white/95 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-lg cursor-pointer animate-fade-in"
          style={{ animation: 'fadeInDown 250ms ease-out' }}
        >
          <p className="font-body text-sm text-text-forest leading-snug">
            If you can't hear audio, check that your device isn't on silent mode.
          </p>
          <style>{`
            @keyframes fadeInDown {
              from { opacity: 0; transform: translateY(-8px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </>
  )
}
