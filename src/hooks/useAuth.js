import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

// Called once at the app root. Subscribes to Supabase auth state changes and
// keeps the Zustand store in sync. Also fetches child profiles so the
// onboarding gate in ProtectedRoute knows whether to redirect.
export function useAuth() {
  const setUser = useStore((state) => state.setUser)
  const setSession = useStore((state) => state.setSession)
  const setLoading = useStore((state) => state.setLoading)
  const setChildProfiles = useStore((state) => state.setChildProfiles)
  const setActiveChild = useStore((state) => state.setActiveChild)

  useEffect(() => {
    async function handleSession(session) {
      setSession(session)
      setUser(session?.user ?? null)

      if (session?.user) {
        const { data } = await supabase
          .from('children')
          .select('id, first_name')
          .eq('parent_id', session.user.id)

        const profiles = data ?? []
        setChildProfiles(profiles)

        // For MVP (one child per account), set the first child as active.
        if (profiles.length > 0) {
          setActiveChild(profiles[0])
        }
      } else {
        // Signed out — clear child state
        setChildProfiles(null)
        setActiveChild(null)
      }

      setLoading(false)
    }

    // onAuthStateChange fires INITIAL_SESSION on mount, which covers the
    // initial page-load auth check — no need to call getSession() separately.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])
}
