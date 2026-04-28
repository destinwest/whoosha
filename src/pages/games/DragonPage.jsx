import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import DragonGame from '../../components/games/dragon/DragonGame'

// Protected game page — saves a session record to Supabase on exit.
export default function DragonPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'dragon-breath', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <DragonGame onExit={handleExit} />
    </div>
  )
}
