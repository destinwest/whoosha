// ── MuteButton ─────────────────────────────────────────────────────────────
// Speaker / speaker-muted toggle. Position-agnostic — the parent decides
// placement via className. The button is small (40×40 css px) and uses the
// same translucent-on-dark visual treatment as the SquareGame exit button.

import { useMutePref } from '../../hooks/useMutePref'

export default function MuteButton({ className = '' }) {
  const [muted, toggleMute] = useMutePref()

  return (
    <button
      onClick={toggleMute}
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
  )
}
