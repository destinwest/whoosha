// ── GameShape ─────────────────────────────────────────────────────────────────
// Inline SVG shape icon shown at the top of each home-carousel card. Stroke
// color is fixed (text-forest) so the same JSX renders inside CSS-isolated
// contexts (like clones used in tile-zoom transitions) without needing the
// surrounding `color` cascade.

const STROKE = 'rgba(62, 94, 82, 0.85)'
const SW     = 6

export default function GameShape({ kind, className = '' }) {
  switch (kind) {
    case 'square':
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <rect x="14" y="14" width="72" height="72" rx="22" ry="22"
            stroke={STROKE} strokeWidth={SW} />
        </svg>
      )

    case 'hexagon':
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <polygon points="50,10 86,30 86,70 50,90 14,70 14,30"
            stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" />
        </svg>
      )

    case 'infinity':
      return (
        <svg viewBox="0 0 120 60" fill="none" aria-hidden="true" className={className}>
          <path
            d="M30 30 C30 10 50 10 60 30 C70 50 90 50 90 30 C90 10 70 10 60 30 C50 50 30 50 30 30 Z"
            stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" />
        </svg>
      )

    case 'triangle':
      // Point-up equilateral triangle with softly rounded corners.
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <path d="M50 16 L84 78 L16 78 Z"
            stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )

    case 'star':
      // Five-pointed star outline, one tip oriented up (matches the game).
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <path d="M50 12 L59.4 37.1 L86.1 38.3 L65.2 54.9 L72.3 80.7 L50 66 L27.7 80.7 L34.8 54.9 L13.9 38.3 L40.6 37.1 Z"
            stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )

    case 'heart':
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <path
            d="M50 88 C50 88 14 62 14 36 C14 20 26 12 38 12 C44 12 48 15 50 20 C52 15 56 12 62 12 C74 12 86 20 86 36 C86 62 50 88 50 88 Z"
            stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )

    case 'rainbow':
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <path d="M10 82 C10 42 28 12 50 12 C72 12 90 42 90 82"
            stroke={STROKE} strokeWidth={SW} strokeLinecap="round" />
          <path d="M28 82 C28 52 37 30 50 30 C63 30 72 52 72 82"
            stroke={STROKE} strokeWidth={SW} strokeLinecap="round" />
        </svg>
      )

    case 'flower':
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <circle cx="50" cy="30" r="16" stroke={STROKE} strokeWidth={SW} />
          <circle cx="72" cy="43" r="16" stroke={STROKE} strokeWidth={SW} />
          <circle cx="64" cy="68" r="16" stroke={STROKE} strokeWidth={SW} />
          <circle cx="36" cy="68" r="16" stroke={STROKE} strokeWidth={SW} />
          <circle cx="28" cy="43" r="16" stroke={STROKE} strokeWidth={SW} />
          <circle cx="50" cy="50" r="10" stroke={STROKE} strokeWidth={SW} />
        </svg>
      )

    case 'mystery':
    default:
      // Three small dots — "more to come" without implying a question
      return (
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
          <circle cx="28" cy="50" r="5" fill={STROKE} />
          <circle cx="50" cy="50" r="5" fill={STROKE} />
          <circle cx="72" cy="50" r="5" fill={STROKE} />
        </svg>
      )
  }
}
