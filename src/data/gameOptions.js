// ── gameOptions ──────────────────────────────────────────────────────────────
// The customization CONTRACT for user-selectable game attributes. See
// docs/GAME-CUSTOMIZATION.md for the full design; this module is Phase 1's core.
//
// Two exports drive everything:
//   ATTRIBUTES   — the attribute registry (type + scope), attribute-agnostic.
//   GAME_OPTIONS — per-game { default, allowed } for each attribute. Every
//                  `default` is the game's CURRENT hardcoded setup (verified in
//                  docs §3.2), so a user who changes nothing gets today's exact
//                  experience.
// plus resolveGameSettings(), the pure resolver each game reads through.
//
// DESIGN INVARIANTS (docs §4.4 — the three guardrails that keep "start free,
// tighten later" a safe, migration-free path):
//   1. Orthogonality      — attributes are independent; no attribute's value
//                            implies another's. (Enforced by callers, not here.)
//   2. Graceful resolution — an unknown / removed / wrong-typed override falls
//                            back to the default. (Enforced by resolveOne below.)
//   3. Value-based storage — overrides store explicit VALUES, never a theme id;
//                            a preset is just a bundle that writes these values.
//
// This module imports NOTHING (no React, no browser APIs) so it stays pure and
// node-testable. Keep it that way.

// Attribute registry. `type` gates how an override is validated:
//   'toggle' — boolean; any non-boolean override falls back to default.
//   'enum'   — value must be in the game's `allowed` list, else default.
// `scope` is informational for the eventual menu (per-game vs global controls);
// resolution is per-game either way.
export const ATTRIBUTES = {
  background:   { type: 'enum',   scope: 'per-game' },
  trackTexture: { type: 'enum',   scope: 'per-game' },
  writtenCues:  { type: 'toggle', scope: 'global'   },
  spokenCues:   { type: 'toggle', scope: 'global'   },
}

// Per-game options. INVARIANT: for every enum attribute, `allowed` lists only
// values that RENDER TODAY, and `default` ∈ `allowed`. Free-mix widens these
// lists over time — but a value joins `allowed` in the SAME change that wires
// its renderer, so `allowed ⊆ renderable` always holds. Future values that are
// designed but not yet wired are noted in comments, NOT added to `allowed` yet.
//
// Defaults transcribed from docs/GAME-CUSTOMIZATION.md §3.2 (all code-verified).
export const GAME_OPTIONS = {
  square: {
    // 'meadowDusk' is a cooler twilight recolor of the meadow — the first real
    // multi-value enum, wired in SquareGame's buildMeadowBg (Phase 2 slice).
    background:   { default: 'meadow',    allowed: ['meadow', 'meadowDusk'] },
    trackTexture: { default: 'dirt',      allowed: ['dirt'] },
    writtenCues:  { default: true },
    // (menu:false on an attribute ⇒ resolves normally but is hidden from the
    // customize panel — used for toggles a game cannot honor yet.)
    spokenCues:   { default: false },   // wired via useSpokenCues — toggle shown
  },
  hexagon: {
    background:   { default: 'sandstone', allowed: ['sandstone'] },
    trackTexture: { default: 'dirt',      allowed: ['dirt'] },
    writtenCues:  { default: true },
    spokenCues:   { default: false },   // wired via useSpokenCues — toggle shown
  },
  triangle: {
    background:   { default: 'sky',       allowed: ['sky'] },
    // scree→firn ported into TriangleCanvas (buildScreeBand), user-approved 2026-08-25.
    trackTexture: { default: 'slate',     allowed: ['slate', 'screeFirn'] },
    writtenCues:  { default: true },
    spokenCues:   { default: false },   // wired via useSpokenCues — toggle shown
  },
  star: {
    background:   { default: 'nightSky',  allowed: ['nightSky'] },
    trackTexture: { default: 'gradient',  allowed: ['gradient'] },
    // Star is voice-only today (StarGame.jsx:29) — that's the default, not a bug.
    writtenCues:  { default: false, menu: false },   // this game has no written labels
    spokenCues:   { default: true },   // wired via useVoice — toggle shown
  },
  infinity: {
    background:   { default: 'lake',      allowed: ['lake'] },
    trackTexture: { default: 'ribbon',    allowed: ['ribbon'] },
    // Labels couple with the countdown slot — the written toggle isn't wired yet.
    writtenCues:  { default: true, menu: false },
    spokenCues:   { default: false },   // wired via useVoice — toggle shown
  },
  rainbow: {
    background:   { default: 'firstLight', allowed: ['firstLight'] },
    trackTexture: { default: 'arcs',       allowed: ['arcs'] },
    // Rainbow conveys phase visually + an in-cloud countdown; no in/out text today.
    writtenCues:  { default: false, menu: false },   // this game has no written labels
    spokenCues:   { default: false },   // wired via useSpokenCues — toggle shown
  },
  heart: {
    background:   { default: 'field',     allowed: ['field'] },
    trackTexture: { default: 'candy',     allowed: ['candy'] },
    writtenCues:  { default: true },
    spokenCues:   { default: false },   // wired via useVoice — toggle shown
  },
}

// Resolve one attribute's effective value from its spec + a single override.
// This is where guardrail #2 lives: any override that isn't a valid value for
// the attribute silently yields the default.
function resolveOne(spec, attrDef, override) {
  if (override === undefined || override === null) return spec.default
  if (attrDef?.type === 'toggle') {
    return typeof override === 'boolean' ? override : spec.default
  }
  // enum
  return spec.allowed?.includes(override) ? override : spec.default
}

// resolveGameSettings(gameKey, allOverrides) → { [attr]: value }
//   allOverrides is the whole persisted map, { [gameKey]: { [attr]: value } },
//   holding ONLY user-changed values (absence = default). Returns the fully
//   resolved settings for one game. Unknown gameKey → {} (caller keeps its own
//   hardcoded fallback; nothing to resolve).
export function resolveGameSettings(gameKey, allOverrides = {}) {
  const opts = GAME_OPTIONS[gameKey]
  if (!opts) return {}
  const gameOverrides = allOverrides?.[gameKey] ?? {}
  const resolved = {}
  for (const attr of Object.keys(opts)) {
    resolved[attr] = resolveOne(opts[attr], ATTRIBUTES[attr], gameOverrides[attr])
  }
  return resolved
}

// isAllowedValue(gameKey, attr, value) → boolean. For the eventual menu (which
// options to render) and for pruning logic. Toggles accept any boolean.
export function isAllowedValue(gameKey, attr, value) {
  const spec = GAME_OPTIONS[gameKey]?.[attr]
  if (!spec) return false
  if (ATTRIBUTES[attr]?.type === 'toggle') return typeof value === 'boolean'
  return !!spec.allowed?.includes(value)
}

// defaultValue(gameKey, attr) → the default, or undefined if unknown. Used by
// the store to prune overrides that equal the default (see settings storage):
// storing "same as default" would freeze that value and defeat guardrail #2 if
// the default later changes, so those overrides are dropped.
export function defaultValue(gameKey, attr) {
  return GAME_OPTIONS[gameKey]?.[attr]?.default
}
