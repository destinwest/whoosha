# Polish Strategy

How Whoosha adds visual richness (texture, lighting, atmosphere) to game scenes while holding 60fps on iPhone 12+.

This is a living doc. Update the **Decision log** at the end of each session that touches visual code.

---

## Perf budget

**Target hardware floor:** iPhone 12 (A14 Bionic, 4GB RAM, DPR=3, 60Hz).

| Resource | Budget |
|---|---|
| Frame time | 16.6ms (60fps); aim for ≤10ms in game loop, leave headroom for Safari/system |
| Compositing layers | ≤5 concurrent full-screen layers |
| Memory per full-screen layer at DPR=3 | ~12MB |
| Per-frame JS in render loop | <2ms |

## Why we have these rules — the failure modes

Two prior sessions broke iOS perf:

- **Session N-2 (SVG filters):** Applied `filter: url(#...)` referencing SVG `<filter>` chains (likely `feTurbulence` + `feColorMatrix`) to fullscreen or dynamic content. Filter graph re-evaluated on every paint; on iOS Safari several filter primitives run on CPU. Tanked.
- **Session N-1 (CSS overlay stack):** Pivoted to canvas-baked bg + 6 stacked `mixBlendMode: screen` divs. Each blend-mode div creates an isolated stacking context and compositing layer; multiple blend modes are GPU-expensive on iOS and several run partly on CPU. Eased the worst symptoms but still costly; current `main` inherits this layering.

The common failure mode: **per-frame visual cost scales with anything dynamic on screen — gauge changes, blur transitions, paint stroke — multiplying the layer composite work.**

---

## Strategy: Hybrid (bake static, animate one dynamic state)

Three strategies were considered:

| Strategy | Per-frame cost | Dynamic FX | Memory | Verdict |
|---|---|---|---|---|
| A. Bake everything | Near zero | None | Lowest | Too rigid |
| **B. Hybrid (chosen)** | Low (1–2 dynamic layers) | Limited but sufficient | Moderate | ✅ |
| C. Pre-baked variants + crossfade | Near zero | Discrete states | High (~70MB) | Overkill for now |

**Hybrid in practice:**
- Bake textures, gradients, lighting into offscreen canvases at resize → drawn as bitmaps
- Use exactly one CSS `filter: saturate()` for the dynamic heat gauge state
- Allow at most one additional CSS overlay (vignette) for elements that benefit from being above the game canvas

---

## Layering rules (the discipline)

1. **One bg canvas, one game canvas.** All static visual content goes into the bg canvas. No additional persistent layers below the game canvas.
2. **At most one CSS overlay above the game canvas** — currently the vignette div.
3. **No `mixBlendMode` stacks.** A single overlay using blend mode is okay if necessary; stacks are not. Move blend operations into the bake step (Canvas 2D `globalCompositeOperation`).
4. **`filter: blur` only during intro phase.** Remove `will-change: filter` after the phase transition to release the compositing layer.
5. **DPR-aware sizing for every canvas.** Width/height attributes scale by `devicePixelRatio`; CSS dimensions stay in CSS pixels; `ctx.scale(dpr, dpr)` so drawing code stays in CSS-px coordinates.
6. **One `filter: saturate()`** on the wrapper that includes both bg canvas and game canvas. Gauge desaturates everything in lockstep.
7. **Stacked canvas siblings must share positioning.** If two or more canvases live as siblings in a wrapper, **all** must use `position: absolute`. CSS paints positioned elements above non-positioned siblings regardless of DOM order — an opaque baked canvas will silently cover a static-positioned sibling. (Lesson from 2026-05-19, Step 1.)

### Reference architecture

```
[saturate(var(--game-saturation)) wrapper]   ← one GPU filter, gauge-driven
  ├─ [bg canvas, baked]                       ← SVG textures + lighting + gradients
  └─ [game canvas]                            ← dynamic paint/fingerprint/pacing
[vignette div]                                ← outside the filter, anchors the frame
```

Three GPU layers total. iPhone 12 has plenty of headroom.

---

## SVG handling: what's cheap, what's expensive

SVG is preferred for authoring — the aesthetic is richer than what Canvas 2D primitives produce. The performance question is **how** the SVG reaches the screen.

### Cheap on iOS

| Use | iOS cost |
|---|---|
| Static `.svg` asset loaded as `<img>` or `background-image` | One-time rasterization → GPU texture |
| SVG drawn once into an offscreen canvas via `drawImage` | One-time cost at resize; per-frame zero |
| SVG used as `ctx.createPattern()` source | Cached GPU texture after first paint |
| SVG with `<defs>` patterns (no `<filter>`) | Composites like any vector |

### Expensive on iOS — do not do

- `filter: url(#paperGrain)` applied to anything that animates, scales, or transforms — filter graph re-evaluates each paint
- `feTurbulence` evaluated per-frame
- Multi-stage SVG filters whose result region spans the viewport, even one-time
- Inline `<svg>` with `<filter>` inside an element that game code also paints into

### The key move

**Pay the SVG cost once at resize, bake it into a bitmap, never re-evaluate.** SVG is a great authoring format and a terrible runtime format on iOS. Use it as the former, not the latter.

---

## Heat-gauge desaturation + baked content

CSS `filter: saturate()` works on baked canvas content. The filter applies to the *rendered bitmap* of the layer regardless of what produced it (canvas, SVG, image, div).

- **One filter on the wrapper that includes bg canvas + game canvas** — both desaturate together as a unit.
- **GPU color-matrix op at composite time**, well under 1ms on iPhone 12.
- The bake (SVG → canvas bitmap) and the filter (bitmap → screen) are separate pipeline stages and don't interact.

Do **not** desaturate via `ctx.filter` per-frame, `getImageData` pixel ops, or re-baking the bg canvas on gauge change.

---

## Technique catalog

### Track texture
- **Authoring:** static `.svg` (paper grain, brush hatching, etc.)
- **Runtime:** at resize, load via `Image` → draw to offscreen canvas at track resolution → use as `ctx.createPattern()` for racetrack passes
- **Per-frame cost:** zero (GPU texture after first paint)

### Background texture
- **Authoring:** static `.svg`
- **Runtime:** at resize, `drawImage` into the offscreen canvas inside `buildMeadowBg`, composited with the base gradient via Canvas 2D blend modes
- **Per-frame cost:** zero

### Ambient lighting
- **Authoring:** static `.svg` light-pool assets (radial blooms, shafts)
- **Runtime:** baked into the bg canvas at resize using `globalCompositeOperation = 'screen'` (or `'overlay'`) — all composition happens in canvas-land, not CSS
- **Per-frame cost:** zero
- **Animated variant (optional):** if static feels flat, see Step 5 of the staged plan — uses the single CSS overlay slot, which means the vignette must first be baked into the bg canvas.

### Vignette
- Current implementation is a CSS `radial-gradient` div — keep. Cheap, single layer, no SVG needed.

### Heat-gauge desaturation
- CSS `filter: saturate(var(--game-saturation))` on the wrapper containing bg canvas + game canvas.
- Currently in `main` the bg canvas is *outside* this wrapper — fix in Step 1 refactor.

---

## Anti-patterns (locked, do not revisit)

- ❌ `filter: url(#...)` on animating/transforming content
- ❌ `feTurbulence` evaluated per-frame
- ❌ Multi-stage SVG filters spanning the viewport
- ❌ Stacks of `mixBlendMode` divs (current `main` has 6)
- ❌ Animated CSS `filter` chains during gameplay
- ❌ DOM-based per-frame visual effects
- ❌ `getImageData` / per-pixel JS for desaturation or color shifts
- ❌ Re-baking the bg canvas on gauge change
- ❌ Canvases sized without DPR scaling

---

## Current state of `main` (as of 2026-05-19)

Working tree clean. Recovery commit landed. Still violates rules above:

- **6× `mixBlendMode: screen` overlay divs** in `src/components/games/square/SquareGame.jsx` lines ~139–164. Need to be removed; their visual intent gets migrated into the bake.
- **DPR bug in `buildMeadowBg`** — canvas sized at CSS pixels, not device pixels. Will be soft on retina.
- **`bgCanvas` is outside the saturate wrapper.** Doesn't desaturate with the heat gauge. Move inside.
- **`stampStroke.js` is in place** and wired up — no changes needed there.

---

## Staged plan forward

Each step is a separate commit. Each is independently verifiable on iOS. Stop after any step if the result is good enough.

### Step 1 — Refactor baseline (no visual goal; mechanical)
- Delete the 6 `mixBlendMode` overlay divs from `SquareGame.jsx`
- Migrate their visual intent into `buildMeadowBg` using Canvas 2D `globalCompositeOperation` (`screen`, `overlay`)
- Fix DPR in `buildMeadowBg` — size offscreen canvas at `w * dpr × h * dpr`, scale ctx accordingly
- Move `bgCanvas` inside the saturate wrapper
- Verify on iOS: same/better perf, visual is close to current (lighting may shift; polish in later steps)
- Commit

### Step 2 — SVG track texture
- Author or import one `.svg` for track surface texture
- Bake into racetrack passes via `ctx.createPattern()` at resize in `SquareCanvas`
- Verify on iOS. Commit.

### Step 3 — SVG background texture
- One `.svg` for paper/meadow grain
- `drawImage` into `buildMeadowBg` during bake
- Verify on iOS. Commit.

### Step 4 — Refine baked lighting with SVG
- If canvas-composed lighting from Step 1 isn't rich enough, replace with SVG light-pool assets baked in
- Verify on iOS. Commit.

### Step 5 (optional) — One animated overlay
- Only if static lighting feels too flat after Steps 1–4
- The layer budget allows **one** CSS overlay above the game canvas, currently held by the vignette. To add an animated lighting overlay, the vignette must first be baked into the bg canvas (as a darkening pass during `buildMeadowBg`), freeing the overlay slot.
- The new overlay: one div, SVG-as-`background-image`, slow opacity or transform animation. No `mixBlendMode` stack.
- Verify on iOS. Commit.

### Queued cleanups (not on the critical path)

- **Retire `taperedStroke.js`.** `stampStroke.js` is the current "Classic" stroke; `taperedStroke.js` is the prior implementation, retained for reference. Delete after confirming nothing imports it and Classic feels right.

---

## Decisions and dropped scope

- **Lap-color background tint — DROPPED (2026-05-19).** BRIEFING previously specified that the background edges crossfade a faint lap-color tint on each lap. Incompatible with the baked-bg architecture without re-baking or adding overlay layers. Removed from spec; lap progress is communicated entirely through the painted stroke.

---

## Decision log

Append a one-line entry after each session that touches visual code. Format: `YYYY-MM-DD — what was tried — what stuck`.

- 2026-05-19 — Strategy doc drafted; chose Hybrid approach; SVG-as-baked-bitmap unblocked; refactor of `main` queued as Step 1.
- 2026-05-19 — Doc audit: resolved conflicts between BRIEFING and POLISH-STRATEGY. stampStroke confirmed as new Classic; heat gauge moved into BRIEFING; lap-color bg tint dropped; CSS-filter policy in BRIEFING replaced with pointer to this doc.
- 2026-05-19 — Step 1 refactor: baked 6 CSS overlays into `buildMeadowBg`; fixed DPR; moved `bgCanvas` inside the saturate wrapper. Compositing layers ~11 → ~4. Hit CSS painting-order gotcha — opaque positioned `bgCanvas` covered static-positioned `SquareCanvas`. Fixed by making SquareCanvas's `<canvas>` element `position: absolute`. New layering rule #7 added.
