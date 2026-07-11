import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import TriangleGame from '../../components/games/triangle/TriangleGame'

// Protected game page — saves a session record to Supabase on exit.
export default function TrianglePage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'triangle-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <TriangleGame onExit={handleExit} />
    </div>
  )
}
