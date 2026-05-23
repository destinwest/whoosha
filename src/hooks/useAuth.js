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
    // If we just bounced back from a failed OAuth redirect, the URL hash will
    // carry #error=... params and there may be stale PKCE/code-verifier entries
    // in localStorage. Both confuse supabase-js on the next init: it can try to
    // re-process dead OAuth state and leave the listener silent. Cleaning both
    // up here, before the listener registers, lets the next load behave like a
    // fresh visit.
    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      const hasOAuthError = hash && /(?:^|[?&#])error(?:_description)?=/.test(hash)
      if (hasOAuthError) {
        // Strip the hash from the URL bar
        window.history.replaceState({}, '', window.location.pathname + window.location.search)
        // Clear any PKCE / code-verifier remnants supabase-js stashed in localStorage
        try {
          for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const key = window.localStorage.key(i)
            if (key && (key.startsWith('sb-') || key.includes('code-verifier') || key.includes('pkce'))) {
              window.localStorage.removeItem(key)
            }
          }
        } catch { /* localStorage may be blocked — non-fatal */ }
      }
    }

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

    // Fallback unblock: if Supabase doesn't respond within 4s (paused
    // free-tier project, network down, blocked request), force loading=false
    // so the UI becomes interactive. Auth calls from the form will then
    // surface a real error instead of hanging behind a spinner.
    const fallback = setTimeout(() => setLoading(false), 4000)

    return () => {
      clearTimeout(fallback)
      subscription.unsubscribe()
    }
  }, [])
}
