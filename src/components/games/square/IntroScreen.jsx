// ── Colors ────────────────────────────────────────────────────────────────────
const TEXT_COLOR = '#F5F0E8'
const SKIP_COLOR = '#6D9B8A'

// ── IntroScreen ───────────────────────────────────────────────────────────────
// Pure display component — no rAF, no timers, no animation logic.
// Renders centered text and a skip button over the intro overlay.
//
// Props:
//   onSkip() — called when skip is tapped
export default function IntroScreen({ onSkip, textRef, line1Ref, line2Ref }) {
  return (
    <div ref={textRef} className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">

      <p
        ref={line1Ref}
        className="font-body font-semibold text-center px-8 leading-snug"
        style={{ color: TEXT_COLOR, fontSize: 'clamp(1.125rem, 5.5vmin, 2.25rem)', opacity: 0 }}
      >
        Ready to begin?
      </p>

      <p
        ref={line2Ref}
        className="font-body font-semibold text-center px-8 mt-4 leading-snug"
        style={{ color: TEXT_COLOR, fontSize: 'clamp(1.125rem, 5.5vmin, 2.25rem)', opacity: 0 }}
      >
        Let's take one good breath together
      </p>

      <button
        onClick={onSkip}
        className="absolute bottom-6 right-6 font-body text-sm"
        style={{ color: SKIP_COLOR, pointerEvents: 'auto' }}
        aria-label="Skip intro"
      >
        skip
      </button>

    </div>
  )
}