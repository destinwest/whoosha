# CLAUDE.md

Operating instructions for Claude Code in the Whoosha repo. Read this first every session.

## Project orientation

Whoosha is a React + Vite + Canvas 2D web app — breathing games for children. The flagship is the Square Breathing game (`src/components/games/square/`). Auth via Supabase, Sentry for errors. Tier gating is a client-side check against `profiles.tier`; no payment processor is wired (deferred post-MVP).

**Read the relevant sections before touching game/visual code — not the whole file.** Both docs are long; open the section that matters for the task, not the full document.
- `BRIEFING.md` — product spec, design system, game mechanics (the WHAT and WHY)
- `POLISH-STRATEGY.md` — iOS perf budget, layering rules, visual technique catalog, anti-patterns (the HOW)

**Source of truth when the two appear to overlap:** `BRIEFING.md` owns product behavior and design intent; `POLISH-STRATEGY.md` owns visual technique, perf rules, and implementation patterns. If they conflict on a visual topic, surface it to the user — do not silently choose.

## iOS performance is a first-class constraint

Target hardware floor: **iPhone 12 and newer.** Real users are parents on iOS Safari.

Two prior sessions broke iOS perf trying to add visual polish. The lessons — layer budget, anti-patterns, why each rule exists — live in `POLISH-STRATEGY.md` (Layering rules + Anti-patterns sections). Read it before touching game/visual code. Do not relitigate those lessons, and do not re-copy the rules here — one copy, no drift.

### Default polish approach

Static SVG assets → baked into an offscreen canvas at resize → composited as bitmap. Per-frame cost: zero. CSS `filter: saturate()` on the wrapper provides dynamic state (heat gauge). See `POLISH-STRATEGY.md` for technique details.

## Workflow rules

1. **Commit after each verified step.** The "two bad sessions" recovery commit is the symptom of skipping this. Smaller commits = smaller blast radius.
2. **State the perf cost before suggesting an approach.** "This adds N compositing layers and M ms per frame." If you can't estimate, say so.
3. **Visual changes must be verified on iOS hardware**, not just desktop Safari or simulator. Vite dev server is exposed via Cloudflare tunnel (already in `vite.config.js`) for this. The user does this verification manually — don't spend tokens on desktop browser preview/screenshot tools for this project; own build/console/functional correctness instead.
4. **End-of-session drift check.** If this session added or removed a file, subsystem, dependency, or scope decision: (a) confirm `BRIEFING.md` still describes the product accurately — it covers intent, not status, so pure-implementation changes usually don't need an edit, but scope changes (e.g. deferring a feature, dropping a dependency) do; (b) append one line to the `POLISH-STRATEGY.md` Decision log — `YYYY-MM-DD — what changed — what stuck`. This single habit is what prevents the docs from rotting.
5. **Only edit `BRIEFING.md` for a scope change** (rule 4 above) or when explicitly asked. Implementation details, technique, and status belong in `POLISH-STRATEGY.md`'s Decision log, not here.

## Stack quick reference

- React 18 + Vite 6, Tailwind 3, Zustand 5
- Canvas 2D for game rendering — no WebGL, no Three.js, no external drawing libs
- Supabase (auth + Postgres), Sentry, Rive (Dragon game only)
- Adaptive audio: synthesis (`src/sound/`) + sampled beds. Samples allowed for atmospheric beds only; breath-coupled / cued elements stay synthesized (POLISH log 2026-06-02)
- Node 18+

## Current state

Status is not tracked here — it drifts. For the live state of `main` and what's next, read the tail of the **Decision log** in `POLISH-STRATEGY.md`.
