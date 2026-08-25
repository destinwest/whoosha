# Game Customization — Design & Refactor Plan

Status: **planning** (no code written yet). This doc is the reference every later
refactor step and asset-authoring task points back to. It captures (1) the
decisions locked in the kickoff conversation, (2) a code-grounded inventory of
where each customizable attribute lives today, and (3) the options-model
contract + phased plan to make those attributes user-selectable.

Owns: the customization data model, attribute taxonomy, and sequencing.
Defers to: `BRIEFING.md` for product intent, `POLISH-STRATEGY.md` for perf/bake
technique (every attribute swap must obey its bake-at-resize rules).

---

## 1. Goal

Let users choose attributes of a breathing game — background, track texture,
written breath instructions on/off, spoken breath instructions on/off, and more
over time. **Each game's current hardcoded setup is the DEFAULT**; customization
is opt-in and never changes default behavior for a user who touches nothing.

---

## 2. Decisions locked in kickoff (2026-08-25)

1. **Sequencing = vertical slice, not assets-first and not refactor-everything-first.**
   - Assets-first is wrong: authoring an asset (e.g. Star's missing written
     labels) before the contract exists means guessing its interface → rework.
   - Refactor-everything-first is risky: with no second real value to test
     against, the abstraction bakes in wrong assumptions.
   - So: **Phase 0 inventory (paper) → Phase 1 contract → Phase 2 prove on ONE
     game end-to-end → Phase 3 fan out + author assets → Phase 4 full menu.**

2. **Freedom model = start FREE mix-and-match, tighten toward curated later.**
   This is the *safe* direction (free→tight is additive; tight→free is a
   rewrite). It also front-loads the hardest, most valuable work: attribute
   **orthogonality**. Three guardrails (§4.4) make the later tightening a
   UI/validation change with zero data migration.

3. **Default = current per-game constants**, captured verbatim as each game's
   `defaults` (§4.2).

4. **Selections persist to the user's Supabase profile** (not just local), so
   they follow the user phone↔desktop — same lesson that drove the trunk-based
   git switch.

---

## 3. Phase 0 — Current-state inventory (code-grounded)

All four v1 attributes are currently **hardcoded constants inside each game**;
there is **no config layer, no settings store slice, and no on/off toggle** for
labels or audio. The only registry is [`src/data/games.js`](../src/data/games.js)
(roster + `GAME_GRADIENTS`); the Zustand store
[`src/store/useStore.js`](../src/store/useStore.js) has auth/child/session slices
but no settings slice.

### 3.1 Attribute taxonomy

| Attribute | Type | Scope | Lives today in | Default source |
|---|---|---|---|---|
| Background | enum | per-game | each game's `build*Bg` (baked at resize) | the one builder each game calls |
| Track texture | enum | per-game | Canvas: SVG pattern / baked band / gradient | see 3.2 |
| Written instructions | toggle | global-ish | per-game DOM label overlay (`LABEL_TEXTS`, CSS-var alpha/scale) | on everywhere **except Star** |
| Spoken instructions | toggle | global-ish | `starVoice.js` + `useStarVoice` | on **only for Star** |

Background & track texture are **per-game** (a value only makes sense for that
shape/scene). Instruction toggles are **global-ish** (the concept is
cross-game, but each game needs its own assets to satisfy "on").

### 3.2 Per-game current state (all cells verified against code)

| Game | Background builder | Track texture | Written labels | Spoken cues |
|---|---|---|---|---|
| Square | `buildMeadowBg` ([SquareGame.jsx:31](../src/components/games/square/SquareGame.jsx#L31)) | SVG dirt pattern `track-dirt.svg` ([SquareCanvas.jsx:907](../src/components/games/square/SquareCanvas.jsx#L907)) | yes — `LABEL_TEXTS` ([SquareGame.jsx:166](../src/components/games/square/SquareGame.jsx#L166)) | none |
| Hexagon | `buildWaveBg` ([HexagonGame.jsx:31](../src/components/games/hexagon/HexagonGame.jsx#L31)) | SVG dirt pattern ([HexagonCanvas.jsx:955](../src/components/games/hexagon/HexagonCanvas.jsx#L955)) | yes — `LABEL_TEXTS` (6 sides) ([HexagonGame.jsx:158](../src/components/games/hexagon/HexagonGame.jsx#L158)) | none |
| Triangle | `buildSkyBg` ([TriangleGame.jsx:69](../src/components/games/triangle/TriangleGame.jsx#L69)) | **gradient only** — `buildTrackGradient` (slate); scree→firn parked on `triangle/next` | yes — `LABEL_TEXTS` ([TriangleGame.jsx:162](../src/components/games/triangle/TriangleGame.jsx#L162)) | none |
| Star | `buildNightSkyBg` ([nightSky.js:25](../src/components/games/_shared/nightSky.js#L25)) | gradient only | **none — deliberate** ([StarGame.jsx:29](../src/components/games/star/StarGame.jsx#L29)) | **yes** — `useStarVoice` / `starVoice.js` |
| Infinity | `buildLakeSurfaceBg` ([lakeSurface.js:86](../src/components/games/infinity/lakeSurface.js#L86)) + shimmer sprite | ribbon/path over baked lake — no separate texture bake ([InfinityCanvas.jsx:100](../src/components/games/infinity/InfinityCanvas.jsx#L100)) | yes — `PHASE_TEXT` in/out + a countdown slot ([InfinityGame.jsx:14](../src/components/games/infinity/InfinityGame.jsx#L14)) | none |
| Rainbow | `buildFirstLightBg` ([RainbowGame.jsx:29](../src/components/games/rainbow/RainbowGame.jsx#L29)) | baked arcs `bakeTrack` ([RainbowCanvas.jsx:254](../src/components/games/rainbow/RainbowCanvas.jsx#L254)) | **none — visual climb + in-cloud "hold N" countdown**, no `breathe in/out` text | none |
| Heart | `buildHeartFieldBg` ([heartField.js:186](../src/components/games/heart/heartField.js#L186)) | baked candy band `buildCandyTexture` ([HeartCanvas.jsx:650](../src/components/games/heart/HeartCanvas.jsx#L650)) | yes — `LABEL_TEXTS` (in/out) ([HeartGame.jsx:21](../src/components/games/heart/HeartGame.jsx#L21)) | none |

**The structural insight:** written `breathe in/out` labels exist on **5 games**
(Square, Hexagon, Triangle, Infinity, Heart) but **two games deliberately have
none** — Star (voice-only) and Rainbow (visual climb + cloud countdown) — for
different design reasons. Spoken cues exist on **exactly one** game (Star). So
the "written" mode has a mature reference impl and two genuine gaps; the
"spoken" mode has a single reference impl (`useStarVoice`) and six gaps. The
refactor's job is to make *both* modes selectable on *every* game.

### 3.3 Asset gaps (what "turn it on" requires that doesn't exist yet)

| Attribute → "on"/alternate value | Exists | Missing |
|---|---|---|
| Written instructions ON | Square, Hexagon, Triangle, Infinity, Heart | **Star** (label design that survives 10 arms — why it was cut) and **Rainbow** (currently conveys phase visually + cloud countdown, no in/out text) |
| Spoken instructions ON | Star (`starVoice`) | **every other game** (author spoken "in/hold/out" clips + wire a `useVoice` generalization of `useStarVoice`) |
| Track texture — 2nd value | Heart (candy), Square/Hex (dirt) | **Triangle** (scree→firn is parked, not merged), Star, and a 2nd option for the rest |
| Background — 2nd value | none (each game has exactly one) | **all** — free-mix needs ≥2 per game to be meaningful |

Precedent to reuse, not reinvent: **global mute** already exists via
[`useMutePref`](../src/hooks/useMutePref.js) (localStorage +
`useSyncExternalStore`, key `whoosha.audio.muted`). The settings store should
follow that module-scope pattern for the local mirror.

---

## 4. The contract (options model)

### 4.1 Attribute schema

A single registry describing every attribute: its type, scope, and — per game —
the allowed values and the default. Free-mix means "allowed" starts wide;
tightening later just prunes these lists (§4.4).

```
ATTRIBUTES = {
  background:  { type: 'enum',   scope: 'per-game' },
  trackTexture:{ type: 'enum',   scope: 'per-game' },
  writtenCues: { type: 'toggle', scope: 'global'   },
  spokenCues:  { type: 'toggle', scope: 'global'   },
}

GAME_OPTIONS = {
  triangle: {
    background:   { default: 'sky',   allowed: ['sky', /* +future */] },
    trackTexture: { default: 'slate', allowed: ['slate', 'screeFirn'] },
    writtenCues:  { default: true },
    spokenCues:   { default: false },
  },
  star: {
    trackTexture: { default: 'gradient', allowed: [...] },
    writtenCues:  { default: false },   // preserves today's voice-only Star
    spokenCues:   { default: true },
    ...
  },
  ...
}
```

Each `default` is transcribed from the game's current hardcoded constant, so a
user who changes nothing gets today's exact experience.

### 4.2 Resolver

```
resolved = resolveSettings(gameKey, userOverrides)
         = for each attribute: userOverrides[gameKey]?.[attr] ?? GAME_OPTIONS[gameKey][attr].default
```

Each game's Canvas/Game reads **only** `resolved.*` — never a hardcoded
constant. That single change (constant → `resolved.x`) is the bulk of the
refactor.

### 4.3 Storage shape

- Persist **explicit per-attribute values** keyed by game, e.g.
  `{ triangle: { trackTexture: 'screeFirn', spokenCues: true } }`. Only store
  overrides (absence = default), so adding attributes later is backward-safe.
- Source of truth = **Supabase profile** (per-user, cross-device); mirror to
  localStorage via a `useSettings` hook shaped like `useMutePref` for instant,
  offline-first reads.
- A **preset/theme is NOT a distinct storage type** — it's a named bundle that
  *writes* the same per-attribute values a user could set by hand. So free-mix
  and curated presets are the same engine and the same stored data.

### 4.4 Invariants (the three guardrails that keep free→tight safe)

1. **Orthogonality.** Every attribute is an independent input to the render
   pipeline: the background bake must not assume a texture, a texture must not
   assume a palette, etc. Coherence is a *separate* layer, never coupling in the
   engine.
2. **Graceful resolution.** An unknown/removed value resolves to the default
   (`allowed.includes(v) ? v : default`). So removing options when tightening
   can never break a saved profile. Build this on day one.
3. **Value-based storage.** Persist explicit values, never a "theme id" — so
   tightening is a UI/allow-list change with **zero data migration**.

---

## 5. Phased plan

**Phase 0 — Inventory & taxonomy.** *(this doc)* Finish the ⚠ audits (Hexagon /
Infinity / Rainbow / Heart label + Infinity texture specifics).

**Phase 1 — Contract.** Add `GAME_OPTIONS` (extend `data/games.js`), the
attribute schema, `resolveSettings`, a `useSettings` hook + Zustand slice, and
Supabase-profile persistence with localStorage mirror. No visible change yet —
each game still renders its defaults, now *via* the resolver.

**Phase 2 — Prove on Square, end to end (full free-mix).** Make Square read
everything from `resolved.*`. Wire a minimal menu for three attributes: written
cues on/off (toggle, ~no assets), spoken cues on/off (toggle — forces the
`useStarVoice`→`useVoice` generalization + first non-Star clips), and **one enum
(background swap between two options)** so the multi-value path is exercised, not
just booleans. Ship it: select → persist to profile → reopen on another device →
restored → renders → re-bake-on-change holds 60fps.

**Phase 3 — Fan out + author assets against the proven contract.** Port the
resolver pattern game by game; author the missing assets one attribute at a
time. **Triangle's parked scree→firn is the natural first track-texture enum
value** (`slate` vs `screeFirn`) — the refactor gives it a home.

**Phase 4 — Full menu UI + (optional) tier gating.** Decide then whether
customization (or the "advanced free-tweak" beyond presets) is a premium tier
feature; gating is a wrapper over the resolved-settings read, not a schema
change.

---

## 6. Perf & iOS (obey POLISH-STRATEGY)

- An attribute change triggers a **re-bake at resize**, not per-frame cost —
  consistent with the existing bake model. Switching = rebuild one offscreen
  bitmap; per-frame stays one `drawImage`.
- More options = more assets to load and hold. **Lazy-load non-default assets**
  (only fetch the dirt SVG / scree band / voice clips a user actually selects)
  to protect the iPhone-12 memory budget (~12MB per full-screen layer).
- Voice clips: `starVoice` decodes on the shared AudioContext; a generalized
  `useVoice` must keep decode lazy and off the unlock path (see StarGame's
  intro-claim guard).

---

## 7. Deferred decisions

- **Final freedom cut** (how curated at public launch) — revisit after free-mix
  exploration reveals which combos read badly.
- **Tier gating** of customization (Phase 4).
- **Attribute set v1** — start with the four here; candidates for later: haptics,
  pacing speed, cycle pattern (e.g. 4-4-4 vs 4-7-8), color/palette independent of
  background, completion screen.
- **Star written-label design** — the open design problem that caused the cut.

---

## 8. Cross-references

- Product intent & design system: `BRIEFING.md`
- Perf budget, bake technique, anti-patterns: `POLISH-STRATEGY.md`
- Registry to extend: [`src/data/games.js`](../src/data/games.js)
- Store to extend: [`src/store/useStore.js`](../src/store/useStore.js)
- Persistence pattern to mirror: [`src/hooks/useMutePref.js`](../src/hooks/useMutePref.js)
- Voice reference impl: [`src/hooks/useStarVoice.js`](../src/hooks/useStarVoice.js), [`src/sound/starVoice.js`](../src/sound/starVoice.js)
