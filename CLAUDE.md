# CLAUDE.md

Operating instructions for Claude Code in the Whoosha repo. Read this first every session.

## Project orientation

Whoosha is a React + Vite + Canvas 2D web app — breathing games for children. The flagship is the Square Breathing game (`src/components/games/square/`). Auth via Supabase, payments via Stripe (test mode), Sentry for errors.

**Read these before touching game/visual code:**
- `BRIEFING.md` — product spec, design system, game mechanics (the WHAT and WHY)
- `POLISH-STRATEGY.md` — iOS perf budget, layering rules, visual technique catalog, anti-patterns (the HOW)

**Source of truth when the two appear to overlap:** `BRIEFING.md` owns product behavior and design intent; `POLISH-STRATEGY.md` owns visual technique, perf rules, and implementation patterns. If they conflict on a visual topic, surface it to the user — do not silently choose.

## iOS performance is a first-class constraint

Target hardware floor: **iPhone 12 and newer.** Real users are parents on iOS Safari.

Two prior sessions broke iOS perf trying to add visual polish. The lessons are in `POLISH-STRATEGY.md`. Do not relitigate them.

### Hard rules — do not violate without explicit user approval

1. **Layer budget: one bg canvas, one game canvas, at most ONE CSS overlay div above them.** Vignette is the allowed overlay.
2. **No `mixBlendMode` chains.** A single overlay using `mixBlendMode` may be acceptable; stacks of them are not.
3. **No `filter: url(#...)` referencing SVG `<filter>` elements applied to animating or transforming content.** Static SVG used as a `<img>`, `background-image`, or pattern source is fine.
4. **No `feTurbulence` evaluated per-frame.** Bake to bitmap once at resize.
5. **`filter: blur` only during the intro phase.** Remove (along with `will-change`) on phase transition to game.
6. **DPR-aware canvas sizing is mandatory.** Any new canvas must scale by `devicePixelRatio`. Verify on retina.
7. **Bake static visual content at resize, not per-frame.** Textures, lighting, gradients → into an offscreen canvas once.

### Default polish approach

Static SVG assets → baked into an offscreen canvas at resize → composited as bitmap. Per-frame cost: zero. CSS `filter: saturate()` on the wrapper provides dynamic state (heat gauge). See `POLISH-STRATEGY.md` for technique details.

## Workflow rules

1. **Commit after each verified step.** The "two bad sessions" recovery commit is the symptom of skipping this. Smaller commits = smaller blast radius.
2. **State the perf cost before suggesting an approach.** "This adds N compositing layers and M ms per frame." If you can't estimate, say so.
3. **Visual changes must be verified on iOS hardware**, not just desktop Safari or simulator. Vite dev server is exposed via Cloudflare tunnel (already in `vite.config.js`) for this.
4. **Update `POLISH-STRATEGY.md` at end of session** with a one-line decision log entry: what was tried, what worked, what didn't.
5. **Do not edit `BRIEFING.md`** unless explicitly asked — it's the product source of truth.

## Stack quick reference

- React 18 + Vite 6, Tailwind 3, Zustand 5
- Canvas 2D for game rendering — no WebGL, no Three.js, no external drawing libs
- Supabase (auth + Postgres), Stripe (test mode), Sentry, Rive (Dragon game only)
- Node 18+

## Current state (2026-05-19, post Step 1)

Main is clean. Step 1 of the polish refactor landed: 6 CSS overlays baked into the bg canvas, DPR fixed, `bgCanvas` moved inside the saturate wrapper, `SquareCanvas` made `position: absolute`. Compositing layer count down from ~11 to ~4. Next up: Step 2 (SVG track texture). See `POLISH-STRATEGY.md` § "Staged plan forward."
