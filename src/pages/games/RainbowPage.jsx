import { useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import RainbowGame from '../../components/games/rainbow/RainbowGame'

// Protected game page — saves a session record to Supabase on exit.
export default function RainbowPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  async function handleExit(dur) {
    if (dur > 2) {
      await saveSession({ gameSlug: 'rainbow-breathing', durationSeconds: dur, completed: true })
    }
    navigate('/home')
  }

  return (
    <div className="fixed inset-0">
      <RainbowGame onExit={handleExit} />
    </div>
  )
}
