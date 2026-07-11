import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import StarGame from '../../components/games/star/StarGame'

// Protected game page — saves a session record to Supabase on exit.
export default function StarPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'star-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <StarGame onExit={handleExit} />
    </div>
  )
}
