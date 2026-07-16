import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import HeartGame from '../../components/games/heart/HeartGame'

// Protected game page — saves a session record to Supabase on exit.
export default function HeartPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'heart-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <HeartGame onExit={handleExit} />
    </div>
  )
}
