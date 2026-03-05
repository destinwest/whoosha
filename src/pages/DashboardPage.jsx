import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4">
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  )
}

export default function DashboardPage() {
  const user        = useStore((state) => state.user)
  const activeChild = useStore((state) => state.activeChild)
  const navigate    = useNavigate()

  async function handleLogout() {
    navigate('/')
    await supabase.auth.signOut()
  }

  const childName = activeChild?.first_name ?? 'your child'

  return (
    <div className="min-h-screen bg-bg-rose flex flex-col">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
        <Link
          to="/home"
          className="font-display text-2xl font-semibold text-text-forest hover:opacity-75 transition-opacity"
        >
          Whoosha
        </Link>
        <button
          onClick={handleLogout}
          className="font-body text-sm font-medium text-text-sage hover:text-text-forest transition-colors"
        >
          Log out
        </button>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col items-center px-6 pt-12 pb-10">
        <div className="w-full max-w-md space-y-6">

          <h1 className="font-display text-4xl font-semibold text-text-forest">
            Your Dashboard
          </h1>

          {/* Child progress card */}
          <div className="bg-white/60 rounded-3xl p-6 space-y-1 shadow-sm">
            <p className="font-body font-semibold text-text-forest capitalize">
              {childName}
            </p>
            <p className="font-body text-sm text-text-sage">
              Progress tracking coming soon 🌱
            </p>
          </div>

          {/* Account link */}
          <Link
            to="/account"
            className="flex items-center justify-between w-full bg-white/60 rounded-3xl px-6 py-5 shadow-sm hover:bg-white/80 transition-colors group"
          >
            <span className="font-body font-medium text-text-forest">Account settings</span>
            <span className="text-text-sage group-hover:text-text-forest transition-colors">
              <ArrowRightIcon />
            </span>
          </Link>

        </div>
      </main>

    </div>
  )
}
