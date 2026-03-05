import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-5 h-5">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export default function AccountPage() {
  const user     = useStore((state) => state.user)
  const navigate = useNavigate()

  async function handleLogout() {
    navigate('/')
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-bg-rose flex flex-col">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
        <Link
          to="/dashboard"
          className="flex items-center gap-1 text-text-sage hover:text-text-forest transition-colors -ml-1"
          aria-label="Back to dashboard"
        >
          <ChevronLeftIcon />
          <span className="font-body text-sm font-medium">Dashboard</span>
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
            Account Settings
          </h1>

          {/* Email card */}
          {user?.email && (
            <div className="bg-white/60 rounded-3xl p-6 shadow-sm">
              <p className="font-body text-xs text-text-sage uppercase tracking-wide mb-1">Email</p>
              <p className="font-body text-text-forest">{user.email}</p>
            </div>
          )}

          {/* Placeholder */}
          <div className="bg-white/60 rounded-3xl p-6 shadow-sm">
            <p className="font-body text-sm text-text-sage">
              Account settings coming soon 🌱
            </p>
          </div>

        </div>
      </main>

    </div>
  )
}
