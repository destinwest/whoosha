import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

// ── Shape icons ────────────────────────────────────────────────────────────────
// All icons use stroke="currentColor" so they inherit card text color.
// viewBox is 64×64 throughout for consistency.

function SquareIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <rect x="10" y="10" width="44" height="44" rx="8" />
    </svg>
  )
}

function InfinityIcon() {
  // Continuous figure-eight: two symmetric loops meeting at center (32,32).
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <path d="M32 32 C40 22 54 22 54 32 C54 42 40 42 32 32 C24 22 10 22 10 32 C10 42 24 42 32 32 Z" />
    </svg>
  )
}

function HexagonIcon() {
  // Regular hexagon centered at (32,32), circumradius 22.
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <polygon points="32,10 51,21 51,43 32,54 13,43 13,21" />
    </svg>
  )
}

function FlowerIcon() {
  // Four petals (circles offset from center) + center circle.
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5"
      strokeLinecap="round" aria-hidden="true" className="w-14 h-14">
      <circle cx="32" cy="17" r="9" />
      <circle cx="47" cy="32" r="9" />
      <circle cx="32" cy="47" r="9" />
      <circle cx="17" cy="32" r="9" />
      <circle cx="32" cy="32" r="7" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-5 h-5">
      <path fillRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
        clipRule="evenodd" />
    </svg>
  )
}

function UserCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-7 h-7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

// ── Game definitions ────────────────────────────────────────────────────────────
// Soothing palette assigned one per card: teal, lavender, amber, sage green.
// Only Square Breathing is free-tier accessible (see Section 10c).

const GAMES = [
  {
    slug: 'square',
    name: 'Square Breathing',
    description: 'Trace the square and breathe',
    path: '/games/square',
    bg: 'bg-secondary',
    Icon: SquareIcon,
  },
  {
    slug: 'infinity',
    name: 'Infinity Breathing',
    description: 'Follow the endless flow',
    path: '/games/infinity',
    bg: 'bg-accent-lavender',
    Icon: InfinityIcon,
  },
  {
    slug: 'hexagon',
    name: 'Hexagon Breathing',
    description: 'Six sides, six slow breaths',
    path: '/games/hexagon',
    bg: 'bg-accent-amber',
    Icon: HexagonIcon,
  },
  {
    slug: 'flower',
    name: 'Flower Breathing',
    description: 'Open and close like petals',
    path: '/games/flower',
    bg: 'bg-primary',
    Icon: FlowerIcon,
  },
]

// ── GameCard ────────────────────────────────────────────────────────────────────

function GameCard({ game, active, onPress }) {
  const { Icon } = game

  return (
    <button
      onClick={() => onPress(game)}
      className={[
        // Base — shared by active and locked
        'relative flex flex-col items-center justify-center gap-3',
        'rounded-3xl p-5 min-h-48 w-full text-center',
        'transition-all duration-150',
        game.bg,
        // Active: subtle scale on hover/press
        active
          ? 'hover:scale-[1.03] active:scale-[0.97] cursor-pointer'
          : 'grayscale opacity-60 hover:opacity-70 cursor-pointer',
      ].join(' ')}
      aria-label={active ? `Play ${game.name}` : `${game.name} — coming soon`}
    >
      {/* Shape icon — inherits text-text-forest */}
      <span className="text-text-forest">
        <Icon />
      </span>

      {/* Game name */}
      <p className="font-body font-semibold text-xl text-text-forest leading-tight">
        {game.name}
      </p>

      {/* One-line description */}
      <p className="font-body text-sm text-text-forest/70 leading-snug">
        {game.description}
      </p>

      {/* Lock badge — top-right corner */}
      {!active && (
        <span
          className="absolute top-3 right-3 text-text-forest/50"
          aria-hidden="true"
        >
          <LockIcon />
        </span>
      )}
    </button>
  )
}

// ── HomePage ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const user = useStore((state) => state.user)
  const activeChild = useStore((state) => state.activeChild)
  const navigate = useNavigate()

  // Default to 'free' while fetching — safer than temporarily showing paid content.
  const [tier, setTier] = useState('free')
  const [toast, setToast] = useState(false)
  const toastTimer = useRef(null)

  // Fetch this parent's tier from the profiles table.
  useEffect(() => {
    if (!user?.id) return

    supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.tier) setTier(data.tier)
      })
  }, [user?.id])

  // Clean up toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  // Section 10c: Square Breathing is always free; everything else requires paid.
  function isGameActive(slug) {
    if (tier === 'paid') return true
    return slug === 'square'
  }

  function handleCardPress(game) {
    if (isGameActive(game.slug)) {
      navigate(game.path)
    } else {
      // Show gentle coming-soon toast; re-tapping resets the timer.
      setToast(true)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(false), 2500)
    }
  }

  const firstName = activeChild?.first_name ?? ''

  return (
    <div className="min-h-screen bg-bg-mint flex flex-col">

      {/* ── Minimal header: logo left, parent icon right ── */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
        <span className="font-display text-2xl font-semibold text-text-forest">
          Whoosha
        </span>
        <Link
          to="/dashboard"
          className="text-text-sage hover:text-text-forest transition-colors p-1 -mr-1 rounded-xl"
          aria-label="Parent dashboard"
        >
          <UserCircleIcon />
        </Link>
      </header>

      {/* ── Greeting ── */}
      <div className="px-6 pt-6 pb-2 flex-shrink-0">
        <h1 className="font-display text-4xl font-semibold text-text-forest">
          {firstName ? `Hi ${firstName} 🌿` : 'Hi there 🌿'}
        </h1>
        <p className="font-body text-text-sage mt-1">
          Which game would you like to play?
        </p>
      </div>

      {/* ── Game grid ── */}
      <main className="flex-1 px-4 pt-6 pb-10">
        <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
          {GAMES.map((game) => (
            <GameCard
              key={game.slug}
              game={game}
              active={isGameActive(game.slug)}
              onPress={handleCardPress}
            />
          ))}
        </div>
      </main>

      {/* ── Coming-soon toast ── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-8 left-1/2 animate-pop-up bg-text-forest text-white font-body text-sm font-medium px-6 py-3 rounded-full shadow-lg whitespace-nowrap z-50"
        >
          Coming soon 🌱
        </div>
      )}

    </div>
  )
}
