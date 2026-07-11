import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'
import GameCarousel from '../components/games/GameCarousel'

async function logout(navigate) {
  // Await signOut BEFORE navigating. If the local session isn't invalidated
  // before we change the route, a failed network call leaves the user
  // technically still authenticated — refreshing or opening /home in a new
  // tab puts them back in. signOut also fires onAuthStateChange(SIGNED_OUT)
  // which clears the Zustand store, so by the time navigate runs the route
  // guards know the user is gone.
  try { await supabase.auth.signOut() } catch { /* network may fail; carry on */ }
  navigate('/')
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

// ── HomePage ──────────────────────────────────────────────────────────────────
// Header (logo + parent menu), greeting, and the fan-card GameCarousel for game
// selection. The carousel owns its own state via useStore.homeActiveCardIndex
// so the last-viewed card persists across navigation.

export default function HomePage() {
  const user        = useStore((state) => state.user)
  const activeChild = useStore((state) => state.activeChild)
  const navigate    = useNavigate()

  // Fetch tier so future paid-feature gates (e.g. unlocking carousel cards)
  // have a value to read. Currently the carousel data hardcodes locked state.
  const [tier, setTier]         = useState('free')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef                 = useRef(null)

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

  // Close parent menu on outside click
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

  const firstName = activeChild?.first_name ?? ''

  // tier is fetched for future use; reference it so lint doesn't flag unused
  void tier

  return (
    <div className="min-h-screen bg-bg-eucalyptus flex flex-col overflow-hidden select-none">

      {/* Header: logo left, parent menu right */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
        <span className="font-display text-2xl font-semibold text-text-forest">Whoosha</span>
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

      {/* Greeting */}
      <div className="px-6 pt-4 pb-2 flex-shrink-0 text-center">
        <h1 className="font-display text-3xl md:text-4xl font-semibold text-text-forest">
          {firstName ? `Hi ${firstName}` : 'Hi there'}
        </h1>
      </div>

      {/* Carousel — fills remaining space vertically */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <GameCarousel />
      </main>

      {/* Footer hint */}
      <div className="text-center text-sm text-text-forest/55 pb-6 px-4">
        Swipe or use the side arrows · Tap a card to play
      </div>
    </div>
  )
}
