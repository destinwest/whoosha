// ── settingsStorage ──────────────────────────────────────────────────────────
// Persistence for the game-customization overrides map
// ({ [gameKey]: { [attr]: value } } — user-changed values only).
//
// TWO tiers, per docs/GAME-CUSTOMIZATION.md §4.3:
//   • LOCAL mirror (localStorage) — offline-first, instant, always on. This is
//     what the store loads from on init and writes to on every change. Mirrors
//     the useMutePref pattern (try/catch around every localStorage call).
//   • REMOTE source of truth (Supabase profile) — cross-device. Wired here but
//     GATED OFF (REMOTE_SETTINGS_ENABLED = false) until the DB column exists.
//
// Enabling remote (a later, separate step — NOT Phase 1) needs:
//   1. A migration adding a JSONB column:
//        alter table profiles add column game_settings jsonb not null default '{}'::jsonb;
//   2. Flip REMOTE_SETTINGS_ENABLED to true.
//   3. Call loadRemoteSettings(userId) after the profile fetch in useAuth.js and
//      hydrate the store (useStore.getState().hydrateGameSettings(...)).
//   4. saveGameSettings() already fires saveRemoteSettings() when enabled.
// Until then the app runs fully on the local mirror with zero Supabase calls.

import { supabase } from './supabaseClient'

export const STORAGE_KEY = 'whoosha.gameSettings'

// Flip to true only alongside the profiles.game_settings migration above.
const REMOTE_SETTINGS_ENABLED = false

// ── Local mirror ──

// Load the overrides map from localStorage. Always returns a plain object;
// never throws (private-mode / cross-origin localStorage can throw or hold junk).
export function loadLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    return {}
  }
}

// Persist the overrides map to localStorage. Silent on failure — the in-memory
// store stays authoritative for the session.
export function saveLocalSettings(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map ?? {}))
  } catch (e) {
    // no-op
  }
}

// ── Combined save (local always; remote when enabled) ──
// The store calls this after every change. Remote is fire-and-forget so a slow
// network never blocks the UI; the local mirror already reflects the change.
export function saveGameSettings(map, userId) {
  saveLocalSettings(map)
  if (REMOTE_SETTINGS_ENABLED && userId) {
    saveRemoteSettings(userId, map)
  }
}

// ── Remote seam (Supabase profile) — dormant until enabled ──

// Fetch the overrides map from the user's profile row. Returns {} on any error
// (including "column doesn't exist yet"), so callers can treat it as best-effort.
export async function loadRemoteSettings(userId) {
  if (!REMOTE_SETTINGS_ENABLED || !userId) return {}
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('game_settings')
      .eq('id', userId)
      .single()
    if (error) return {}
    const gs = data?.game_settings
    return gs && typeof gs === 'object' ? gs : {}
  } catch (e) {
    return {}
  }
}

// Upsert the overrides map onto the user's profile row. Fire-and-forget.
export async function saveRemoteSettings(userId, map) {
  if (!REMOTE_SETTINGS_ENABLED || !userId) return
  try {
    await supabase
      .from('profiles')
      .update({ game_settings: map ?? {} })
      .eq('id', userId)
  } catch (e) {
    // no-op — local mirror already holds the change
  }
}
