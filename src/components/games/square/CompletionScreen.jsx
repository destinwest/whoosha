// ── CompletionScreen ───────────────────────────────────────────────────────
// In-place completion overlay shown after the user exits the game. Sits
// above the dimming game canvas, gives a single calm line ("You breathed
// for mm:ss <emoji>"), and dismisses on either a Done tap or a ~10-second
// timer. On dismissal, calls onDismiss which navigates to /home.
//
// Designed to feel like the world is settling down around the child, not
// a hard screen transition. Card uses the same bg-cream visual language
// as the auth cards so it reads as a "human moment" within the app.

import { useEffect, useMemo, useRef, useState } from 'react'

// Emoji pool — varied between sessions so the completion moment feels
// organic. All match the nature-bathing theme.
const EMOJI_POOL = ['🌿', '🌱', '🍃', '🌸', '🌙']

// Auto-dismiss timer. Long enough that a child who wants to sit with the
// moment can, short enough that an inattentive child isn't left there
// indefinitely. The Done button is the primary path; this is the
// fallback.
const AUTO_DISMISS_MS = 10_000

// Card fade-in delay (lets the game canvas begin dimming first so the
// card arrives into a settled background, not a competing one).
const CARD_FADE_IN_DELAY_MS = 600

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export default function CompletionScreen({ durationSeconds, onDismiss }) {
  const [visible, setVisible] = useState(false)
  const dismissedRef = useRef(false)
  // Pick one emoji per mount — random across sessions, stable within one.
  const emoji = useMemo(() => EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)], [])

  // Single-fire dismissal: protect against both timer + button firing.
  function dismissOnce() {
    if (dismissedRef.current) return
    dismissedRef.current = true
    onDismiss()
  }

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), CARD_FADE_IN_DELAY_MS)
    const auto   = setTimeout(dismissOnce, AUTO_DISMISS_MS)
    return () => {
      clearTimeout(fadeIn)
      clearTimeout(auto)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatted = formatDuration(Math.max(0, durationSeconds || 0))

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center px-6 pointer-events-none"
      aria-live="polite"
    >
      <div
        className="bg-bg-cream rounded-3xl shadow-xl px-10 py-12 max-w-md w-full text-center pointer-events-auto"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 900ms ease, transform 900ms ease',
        }}
      >
        <p className="font-display text-3xl md:text-4xl font-semibold text-text-forest leading-tight">
          You breathed for
          <br />
          <span className="text-primary">{formatted}</span> {emoji}
        </p>

        <button
          onClick={dismissOnce}
          className="mt-10 w-full bg-primary text-white rounded-2xl py-3.5 font-body font-semibold text-lg hover:bg-primary/90 active:bg-primary/80 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}
