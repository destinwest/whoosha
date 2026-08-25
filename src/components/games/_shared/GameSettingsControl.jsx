import { useState } from 'react'
import GameSettingsPanel from './GameSettingsPanel'

// ── GameSettingsControl ───────────────────────────────────────────────────────
// One-line customize control for a game: a gear button (top-right by default,
// matching the exit/mute chrome treatment) that opens the schema-driven
// GameSettingsPanel for `gameKey`. Owns its own open/close state so a game only
// has to drop <GameSettingsControl gameKey="..." /> into its chrome.
//
// Position/size via `className` (defaults to the top-right corner slot the mute
// button used to hold). `tone` matches the game's chrome: 'light' (white glyph,
// for dark backgrounds — Square/Hexagon) or 'dark' (slate glyph, for light
// backgrounds — Triangle/Heart). The panel itself is mounted only while open.
const TONE = {
  light: 'bg-white/15 text-white hover:bg-white/25 active:bg-white/30',
  dark:  'bg-slate-700/15 text-slate-700 hover:bg-slate-700/25 active:bg-slate-700/30',
}

export default function GameSettingsControl({
  gameKey,
  tone = 'light',
  className = 'absolute top-4 right-4 z-20',
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-11 h-11 flex items-center justify-center rounded-2xl transition-colors ${TONE[tone] ?? TONE.light} ${className}`}
        aria-label="Customize game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && <GameSettingsPanel gameKey={gameKey} onClose={() => setOpen(false)} />}
    </>
  )
}
