import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import SquareGame from '../../components/games/square/SquareGame'

// Protected game page — saves a session record to Supabase on exit.
export default function SquarePage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'square-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <SquareGame onExit={handleExit} />
    </div>
  )
}
