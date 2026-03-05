import { useNavigate, Link } from 'react-router-dom'
import SquareGame from '../components/games/square/SquareGame'

// Public demo page — the full Square Breathing game with no login required.
// Session is never saved (no authenticated user / activeChild).
// Accessible from the landing page hero and the /demo route.
export default function DemoPage() {
  const navigate = useNavigate()

  return (
    <div className="fixed inset-0 flex flex-col">

      {/* Sign-up nudge — sits above the game, amber to feel warm not alarming */}
      <div className="flex-shrink-0 bg-accent-amber px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="font-body text-sm font-semibold text-text-forest">
          Sign up to save your progress
        </span>
        <Link
          to="/signup"
          className="font-body text-sm font-semibold text-text-forest underline underline-offset-2 hover:opacity-75 transition-opacity"
        >
          Create a free account →
        </Link>
      </div>

      {/* Game fills the remaining viewport — exit returns to landing */}
      <div className="relative flex-1 min-h-0">
        <SquareGame onExit={() => navigate('/')} />
      </div>

    </div>
  )
}
