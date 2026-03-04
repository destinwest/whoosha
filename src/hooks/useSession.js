import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

export function useSession() {
  const activeChild = useStore((state) => state.activeChild)

  async function saveSession({ gameSlug, durationSeconds, completed }) {
    if (!activeChild?.id) return

    const { error } = await supabase.from('sessions').insert({
      child_id: activeChild.id,
      game_slug: gameSlug,
      duration_seconds: durationSeconds,
      completed,
    })

    if (error) console.error('Failed to save session:', error)
  }

  return { saveSession }
}
