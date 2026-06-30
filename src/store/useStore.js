import { create } from 'zustand'

const useStore = create((set) => ({
  // Auth state
  // loading starts true — stays true until the initial Supabase auth check resolves,
  // preventing a flash of unauthenticated content on page load.
  user: null,
  session: null,
  loading: true,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),

  // Child profiles for the logged-in parent
  // null  = not yet fetched
  // []    = no children exist → triggers onboarding redirect
  // [...] = has at least one child
  childProfiles: null,
  setChildProfiles: (childProfiles) => set({ childProfiles }),

  // The child currently playing (for session saves and greeting)
  activeChild: null,
  setActiveChild: (child) => set({ activeChild: child }),

  // Game session state (active during a game)
  gameSession: null,
  setGameSession: (session) => set({ gameSession: session }),
  clearGameSession: () => set({ gameSession: null }),

  // Home-carousel active card index (persists across navigation within session).
  // 3 = Square's position in src/data/games.js — the default centered card.
  homeActiveCardIndex: 3,
  setHomeActiveCardIndex: (i) => set({ homeActiveCardIndex: i }),

  // Card→game zoom transition. Holds the tapped card's on-screen rect + target
  // route so the app-level overlay (above the router) can zoom from the card to
  // full screen and hand off into the game's intro. null = no transition active.
  cardTransition: null,
  startCardTransition: (fromRect, route) => set({ cardTransition: { fromRect, route } }),
  endCardTransition: () => set({ cardTransition: null }),
}))

export default useStore
