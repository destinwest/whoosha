import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import HexagonGame from '../../components/games/hexagon/HexagonGame'

// Protected game page — saves a session record to Supabase on exit.
export default function HexagonPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'hexagon-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <HexagonGame onExit={handleExit} />
    </div>
  )
}
