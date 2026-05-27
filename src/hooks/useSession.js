import * as Sentry from '@sentry/react'
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

    // Send to Sentry rather than console.error: the latter lands in the
    // browser console where it's visible to the user and any extension
    // reading their console output, and Supabase error payloads can hint
    // at table structure / RLS state.
    if (error) Sentry.captureException(error, { tags: { area: 'session-insert', gameSlug } })
  }

  return { saveSession }
}
