import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'
import GameCard from '../components/games/GameCard'

async function logout(navigate) {
  navigate('/')
  await supabase.auth.signOut()
}

// ── Shape icons ────────────────────────────────────────────────────────────────
// stroke is an inline attribute (not currentColor) so clones render correctly
// in the zoom portal, which has no CSS color context.
// #3E5E52 = text-forest — visually identical to the previous currentColor approach.

function SquareIcon({ fill = 'none' }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="#3E5E52" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <rect x="10" y="10" width="44" height="44" rx="8" fill={fill} />
    </svg>
  )
}

function InfinityIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="#3E5E52" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <path d="M32 32 C40 22 54 22 54 32 C54 42 40 42 32 32 C24 22 10 22 10 32 C10 42 24 42 32 32 Z" />
    </svg>
  )
}

function HexagonIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="#3E5E52" strokeWidth="3.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-14 h-14">
      <polygon points="32,10 51,21 51,43 32,54 13,43 13,21" />
    </svg>
  )
}

function FlowerIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="#3E5E52" strokeWidth="3.5"
      strokeLinecap="round" aria-hidden="true" className="w-14 h-14">
      <circle cx="32" cy="17" r="9" />
      <circle cx="47" cy="32" r="9" />
      <circle cx="32" cy="47" r="9" />
      <circle cx="17" cy="32" r="9" />
      <circle cx="32" cy="32" r="7" />
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
// Icons are instantiated as elements here so the same ReactNode renders in both
// the card and the ZoomOverlay portal clone.

const GAMES = [
  {
    id: 'square',
    label: 'Square Breathing',
    description: 'Trace the square and breathe',
    route: '/games/square',
    bg: 'bg-secondary',
    icon: <SquareIcon />,
    // Clone shown during zoom: rect filled with game-intro dark so the interior
    // is solid as it expands. Card icon stays fill="none".
    zoomIcon: <SquareIcon fill="#2C4A3E" />,
    // Bottom-right corner of the rect (arc midpoint at 45°):
    // viewBox (46+8·cos45°, 46+8·sin45°) = (51.66, 51.66) → 51.66/64 × 56 = 45.2px → 45.2/56 = 0.807
    focalPoint: { x: 0.807, y: 0.807 },
  },
  {
    id: 'infinity',
    label: 'Infinity Breathing',
    description: 'Follow the endless flow',
    route: '/games/infinity',
    bg: 'bg-accent-lavender',
    icon: <InfinityIcon />,
  },
  {
    id: 'hexagon',
    label: 'Hexagon Breathing',
    description: 'Six sides, six slow breaths',
    route: '/games/hexagon',
    bg: 'bg-accent-amber',
    icon: <HexagonIcon />,
  },
  {
    id: 'flower',
    label: 'Flower Breathing',
    description: 'Open and close like petals',
    route: '/games/flower',
    bg: 'bg-primary',
    icon: <FlowerIcon />,
  },
]

// ── HomePage ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const user        = useStore((state) => state.user)
  const activeChild = useStore((state) => state.activeChild)
  const navigate    = useNavigate()

  // Default to 'free' while fetching — safer than temporarily showing paid content.
  const [tier, setTier]     = useState('free')
  const [fading, setFading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef    = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

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

  // Close menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  // Section 10c: Square Breathing is always free; everything else requires paid.
  function isGameActive(id) {
    if (tier === 'paid') return true
    return id === 'square'
  }

  // Called by GameCard when the zoom sequence begins.
  // Also handles the cancelled-navigation fallback: GameCard resets zoomActive
  // after 800ms if still mounted, but we need to restore opacity here too.
  // We simply reset fading after 900ms if this component is still mounted
  // (i.e. navigation failed — we never left the page).
  function handleZoomStart() {
    setFading(true)
    setTimeout(() => {
      if (mountedRef.current) setFading(false)
    }, 900)
  }

  const firstName = activeChild?.first_name ?? ''

  return (
    <div
      className="min-h-screen bg-bg-eucalyptus flex flex-col"
      style={{
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 450ms cubic-bezier(0.4, 0, 0, 1)' : 'none',
      }}
    >

        {/* ── Minimal header: logo left, parent icon right ── */}
        <header className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
          <span className="font-display text-2xl font-semibold text-text-forest">
            Whoosha
          </span>
          {/* Parent icon → dropdown with Dashboard + Log out */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="text-text-sage hover:text-text-forest transition-colors p-1 -mr-1 rounded-xl"
              aria-label="Parent menu"
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <UserCircleIcon />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white rounded-2xl shadow-lg overflow-hidden z-50 border border-black/5">
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-3 font-body text-sm font-medium text-text-forest hover:bg-bg-cream transition-colors"
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => logout(navigate)}
                  className="block w-full text-left px-4 py-3 font-body text-sm font-medium text-text-sage hover:bg-bg-cream transition-colors border-t border-black/5"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
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
                key={game.id}
                id={game.id}
                label={game.label}
                description={game.description}
                icon={game.icon}
                zoomIcon={game.zoomIcon}
                route={game.route}
                bg={game.bg}
                active={isGameActive(game.id)}
                onZoomStart={handleZoomStart}
                focalPoint={game.focalPoint}
              />
            ))}
          </div>
        </main>

    </div>
  )
}
