import { create } from 'zustand'
import { defaultValue } from '../data/gameOptions'
import { STORAGE_KEY as SETTINGS_STORAGE_KEY, loadLocalSettings, saveGameSettings } from '../lib/settingsStorage'

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

  // ── Game customization overrides ──────────────────────────────────────────
  // The persisted map of user-changed attribute values, { [gameKey]: { [attr]:
  // value } }, holding ONLY overrides (absence = default). Games read through
  // resolveGameSettings (via the useSettings hook), never this raw map. See
  // docs/GAME-CUSTOMIZATION.md. Loaded from the localStorage mirror on init;
  // the Supabase remote tier is dormant until its migration lands (see
  // settingsStorage.js).
  gameSettings: loadLocalSettings(),

  // Set one attribute for one game. Accepting a value equal to the current
  // default PRUNES the override (stores nothing) — freezing "same as default"
  // would defeat guardrail #2 if the default later changes. A game whose
  // overrides all get pruned drops out of the map entirely.
  setGameOption: (gameKey, attr, value) => set((state) => {
    const gameMap = { ...(state.gameSettings[gameKey] ?? {}) }
    if (value === defaultValue(gameKey, attr)) delete gameMap[attr]
    else gameMap[attr] = value
    const next = { ...state.gameSettings }
    if (Object.keys(gameMap).length === 0) delete next[gameKey]
    else next[gameKey] = gameMap
    saveGameSettings(next, state.user?.id)
    return { gameSettings: next }
  }),

  // Clear all overrides for one game (back to its defaults).
  resetGameOptions: (gameKey) => set((state) => {
    if (!state.gameSettings[gameKey]) return {}
    const next = { ...state.gameSettings }
    delete next[gameKey]
    saveGameSettings(next, state.user?.id)
    return { gameSettings: next }
  }),

  // Clear every override across all games.
  resetAllGameOptions: () => set((state) => {
    saveGameSettings({}, state.user?.id)
    return { gameSettings: {} }
  }),

  // Replace the whole map without re-persisting (used by the cross-tab storage
  // listener below, and by the future remote-load hydrate). The source that
  // called this already owns persistence.
  hydrateGameSettings: (map) => set({
    gameSettings: map && typeof map === 'object' ? map : {},
  }),
}))

// Cross-tab sync: another tab changing a game setting writes the localStorage
// mirror; reflect it here so every tab agrees. Mirrors useMutePref's listener.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SETTINGS_STORAGE_KEY) return
    useStore.getState().hydrateGameSettings(loadLocalSettings())
  })
}

export default useStore
