import { useEffect } from 'react'
import * as Sentry from '@sentry/react'
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
        const { data, error } = await supabase
          .from('children')
          .select('id, first_name')
          .eq('parent_id', session.user.id)

        // If the fetch fails (network, RLS misconfigured, etc.) we still need
        // to set childProfiles to something so the ProtectedRoute guard can
        // proceed — the empty-array fallback sends the user to /onboarding,
        // which is the safer-of-two-evils degradation. Capture to Sentry so
        // the failure isn't silent in dev/prod.
        if (error) {
          Sentry.captureException(error, { tags: { area: 'children-fetch' } })
        }
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
      // Defensive URL-hash cleanup after OAuth / magic-link callback.
      // supabase-js's detectSessionInUrl normally strips the hash itself,
      // but flow-type / version / React Router timing edges can leave
      // #access_token=... visible in the URL bar even after the session
      // is established. URL fragments aren't sent to servers (RFC 3986),
      // but they do persist in browser history, screen sharing, and sync.
      // Targeted check on token-shaped fragments only, so legitimate
      // anchor hashes (e.g. #how-it-works on the landing page) are
      // preserved.
      if (window.location.hash && /access_token|refresh_token/.test(window.location.hash)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
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
