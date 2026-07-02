import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import InfinityGame from '../../components/games/infinity/InfinityGame'

// Protected game page — saves a session record to Supabase on exit.
export default function InfinityPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'infinity-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <InfinityGame onExit={handleExit} />
    </div>
  )
}
