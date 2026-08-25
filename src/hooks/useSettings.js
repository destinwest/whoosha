// ── useSettings ──────────────────────────────────────────────────────────────
// The read API for game customization. A game calls useSettings(gameKey) and
// gets its fully RESOLVED attribute values (defaults ⊕ the user's overrides,
// run through the graceful resolver) plus setters. Games read `settings.*`
// instead of hardcoded constants — that swap is the substance of the Phase 2+
// refactor (docs/GAME-CUSTOMIZATION.md §4.2).
//
// Reactive: it selects the overrides map from the store, so any setOption /
// reset (this tab or another, via the store's storage listener) re-resolves and
// re-renders. Resolution is memoized on (gameKey, overrides) so a game only
// recomputes when something it depends on actually changes.

import { useMemo } from 'react'
import useStore from '../store/useStore'
import { resolveGameSettings } from '../data/gameOptions'

export function useSettings(gameKey) {
  const overrides        = useStore((s) => s.gameSettings)
  const setGameOption    = useStore((s) => s.setGameOption)
  const resetGameOptions = useStore((s) => s.resetGameOptions)

  const settings = useMemo(
    () => resolveGameSettings(gameKey, overrides),
    [gameKey, overrides],
  )

  const setOption = useMemo(
    () => (attr, value) => setGameOption(gameKey, attr, value),
    [gameKey, setGameOption],
  )
  const reset = useMemo(
    () => () => resetGameOptions(gameKey),
    [gameKey, resetGameOptions],
  )

  return { settings, setOption, reset }
}
