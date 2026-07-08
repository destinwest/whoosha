# Whoosha Doc Reconciliation — Edit List

**Purpose:** Bring `BRIEFING.md`, `CLAUDE.md`, and `POLISH-STRATEGY.md` back in sync with the actual repo.
**Verified against:** working tree at HEAD (`first pass at infinity breathing game`, 2026-07-02).
**Method:** every change below was checked against the real `src/` and `public/` tree, not just cross-referenced between docs.

Give this file to Claude Code as a one-shot session instruction, or apply by hand. It touches all three docs, so temporarily lift the "do not edit BRIEFING.md" rule for this pass.

---

## A. BRIEFING.md

### A1. Remove Stripe as an active MVP dependency
Stripe was deleted from the codebase (no references remain in `src/`; `src/lib/stripe.js` and `@stripe/stripe-js` are gone). Update every place that still treats it as build-now:

- **§3 Tech Stack → "Backend Services (MVP)":** move the Stripe row out of the MVP table and into **"Pre-Launch (Do Not Build Yet)"** (Stripe Live Mode is already listed there — collapse the test-mode line into it).
- **§10 Environment Variables:** delete the `VITE_STRIPE_PUBLISHABLE_KEY` block, or move it under a clearly labeled "post-MVP / not yet wired" note.
- **§11 Tier Definitions:** reword "Used by Stripe test mode access checks" → "Used by the client-side tier check (reads `profiles.tier`); payment wiring is deferred post-MVP."
- **§14 MVP Definition:** in "In Scope," delete "Stripe test mode integration (simulated free vs paid tier access check)." The tier check itself is still in scope, but not via Stripe — reword to "Client-side free/paid tier gating from `profiles.tier`." Confirm Stripe is listed under "Explicitly Out of Scope" (it already says "Real payments (Stripe test mode only)" — reword to just "Payments / Stripe — deferred post-MVP").

### A2. Fix the folder tree (§9) — it is significantly out of date
Replace the `src/` and `public/` tree with the corrected version in **Appendix 1** below. Key deltas the current tree gets wrong:
- **Lists deleted files:** `taperedStroke.js` (gone) and `src/lib/stripe.js` (gone) — remove both.
- **Omits `src/data/`** — the folder exists (`games.js`) and is even referenced in §6.3, but the tree doesn't show it.
- **Omits the entire `src/sound/` subsystem** — 8 files (`SoundDirector.js`, `noiseBuffer.js`, `reverb.js`, `synthAmbient.js`, `synthBowl.js`, `synthBreath.js`, `synthHexBreath.js`, `synthRumble.js`).
- **Omits `hexagon/` and `infinity/` game folders** — both exist with `*Game.jsx`, `*Canvas.jsx`, `*CardPreview.jsx`.
- **Omits `_shared/`** — `heatGauge.js`, `roundedPolyPath.js`, `synergy.js` (and `roundedNgonPath.js`, see D1).
- **Omits several files:** `GameShape.jsx`, `SquareCardPreview.jsx`, `CompletionScreen.jsx`, `MuteButton.jsx`, `PrivacyPage.jsx`, `TermsPage.jsx`, `HexagonPage.jsx`, `InfinityPage.jsx`, sound-related hooks (`useHexBreath.js`, `useMutePref.js`, `useSoundDirector.js`).
- **Second transitions folder:** `src/components/transitions/` (`FadeLaunch.jsx`, `GameLaunch.jsx`) exists alongside `src/components/ui/transitions/`. Document both and clarify ownership (see A6).
- **Phantom assets:** `public/favicon.ico` and `public/og-image.png` are listed but not present on disk — either add the files or drop them from the tree.

### A3. Acknowledge the audio system (§1, §6.4)
- **§1 App Concept:** "audio cues (todo)" is false — a full synthesized + sampled sound system shipped (2026-05-24 / 2026-06-02). Change to a one-line pointer: "audio is implemented — see the sound architecture summary in `POLISH-STRATEGY.md`."
- **§6.4:** add a short "Sound (see POLISH-STRATEGY)" subsection noting that adaptive audio exists and that *design intent* lives here while *technique* lives in POLISH — consistent with your existing WHAT/HOW split. Don't duplicate the synthesis detail.

### A4. Reconcile "No completion state" (§6.4) with `CompletionScreen.jsx`
The line "No completion state. The game runs indefinitely" now conflicts with a shipped session-end card. Reword to preserve the intent without the contradiction: "The *game loop* never ends — there is no win/lose state. When the child taps exit, a gentle session-end card (`CompletionScreen.jsx`) summarizes the session before returning home."

### A5. Reflect that Hexagon and Infinity are in development, not just locked cards
§6.3 and §11 present them as frosted future cards; they're partially built. Add a one-line status note near §6.3 (or a small "Build status" line per game) — e.g. "Hexagon: playable, geometry + label-pulse complete. Infinity: scaffold on `infinity-breathing` branch." Keep the carousel lock/tier behavior as-is (that's product intent); this is just so the spec doesn't read as if no work has started.

### A6. Clarify the two transition systems (§6.0)
§6.0 says the intro system lives in `src/components/ui/transitions/`. There is now also `src/components/transitions/` (`FadeLaunch.jsx`, `GameLaunch.jsx`), presumably the home-card → game route launch. Add one sentence distinguishing them: intro/threshold transitions in `ui/transitions/`; route-launch transitions in `components/transitions/`. Otherwise the ownership boundary is ambiguous.

---

## B. CLAUDE.md

### B1. Delete the stale "Current state (2026-05-19, post Step 1)" block
This is the highest-impact fix. It tells a fresh session "Next up: Step 2 (SVG track texture)" when the project is four-plus sessions past that (sound, hexagon, infinity, cleanup all landed after). Two options:
- **Preferred:** delete the block entirely and replace with a single pointer: "For current status, read the tail of the Decision log in `POLISH-STRATEGY.md`." (See structural fix S1.)
- **Minimum:** replace its contents with the true HEAD state and re-date it.

### B2. Remove Stripe from orientation + stack
- "Project orientation" line "payments via Stripe (test mode)" → drop, or "(payments deferred post-MVP)".
- "Stack quick reference" → remove the "Stripe (test mode)" bullet.

### B3. Frame the "Hard rules" as a summary, not a second source of truth
The 7 hard rules duplicate POLISH-STRATEGY's Layering rules + Anti-patterns. They're currently in sync but will drift. Add a header line: "These are a tripwire summary. `POLISH-STRATEGY.md` is authoritative — if this list and that doc disagree, that doc wins." That preserves the always-loaded tripwire value while removing the ambiguity about which copy governs.

### B4. Add the no-new-audio-samples nuance
CLAUDE.md doesn't carry the audio rule at all, and the rule flip-flopped (2026-05-24 "no samples" → 2026-06-02 "samples allowed for beds, synth for cued elements"). Add one line to the hard rules or stack section so a session doesn't reintroduce a retired `.mp3` or, conversely, think all audio must be synthesized: "Audio: samples allowed for atmospheric beds only; breath-coupled / cued elements stay synthesized (see POLISH log 2026-06-02)."

---

## C. POLISH-STRATEGY.md

### C1. Delete or refresh "Current state of main (as of 2026-05-19, post Step 1)"
Same staleness as B1 — this snapshot predates everything in its own Decision log below it. Since the Decision log already carries live status, delete the standalone "Current state" section and let the log tail be the single source (S1).

### C2. Update the reference architecture — it omits the pacing canvas
The reference diagram shows three GPU layers (bg + game + vignette), but "current state" says ~4 and the 2026-07-02 Infinity entry describes "one bg canvas + one game canvas + pacing canvas + vignette." Either the pacing canvas is a real fourth persistent layer (then add it to the diagram and the layer-budget rules and bump the "three layers total" line) or it's transient (then say so). Right now the canonical diagram doesn't match the shipped layering.

### C3. Sync the "Staged plan forward" with reality
Steps 1–5 imply the track/background SVG texture work is still ahead. Check whether Steps 2–4 landed (the `public/textures/track-dirt.svg` and `meadow-ground.svg` assets exist, suggesting at least partial completion) and mark completed steps done, or move them into the Decision log.

*(POLISH's Stripe mention is the deletion record in the Decision log — that one is correct and should stay.)*

---

## D. Code cleanup surfaced during review (optional, not doc edits)

### D1. `roundedNgonPath.js` appears orphaned
After the hexagon migration to `roundedPolyPath`/`offsetPolygon` (log 2026-07-01), no game component imports `roundedNgonPath` — the only files containing the name are its own definition and a mention inside `roundedPolyPath.js`. Confirm Square no longer uses it, then delete it (mirrors the earlier `taperedStroke.js` retirement). If Square *does* still use it, the 2026-07-01 log wording ("replace `roundedNgonPath`") overstates the migration and should be softened.

---

## Structural fixes (the root cause — do these and most drift stops recurring)

**S1. One home for status.** Delete every dated "Current state" snapshot from `CLAUDE.md` and `POLISH-STRATEGY.md`. Keep live status only in the POLISH Decision log tail. Snapshots that live in two files are guaranteed to disagree — that's the source of the two biggest inconsistencies here.

**S2. Schedule a BRIEFING reconciliation ritual.** The "do not edit BRIEFING.md unless explicitly asked" rule is what let Stripe, audio, deleted files, and two in-progress games rot in the spec. You did one audit on 2026-05-19; make it recurring (e.g. a checklist item at the end of any session that adds/removes a file or subsystem: "does BRIEFING §9 + affected section still match?"). BRIEFING is currently the "source of truth" that's furthest from the truth.

---

## Appendix 1 — Corrected `src/` and `public/` tree (actual, at HEAD)

```
src/
├── main.jsx
├── App.jsx
├── index.css
├── lib/
│   └── supabaseClient.js
├── store/
│   └── useStore.js
├── data/
│   └── games.js
├── hooks/
│   ├── useAuth.js
│   ├── useSession.js
│   ├── useHexBreath.js
│   ├── useMutePref.js
│   └── useSoundDirector.js
├── sound/
│   ├── SoundDirector.js
│   ├── noiseBuffer.js
│   ├── reverb.js
│   ├── synthAmbient.js
│   ├── synthBowl.js
│   ├── synthBreath.js
│   ├── synthHexBreath.js
│   └── synthRumble.js
├── components/
│   ├── auth/
│   │   └── AuthForm.jsx
│   ├── layout/
│   │   ├── Navbar.jsx
│   │   ├── AppNav.jsx
│   │   └── Footer.jsx
│   ├── ui/
│   │   ├── Button.jsx
│   │   ├── Card.jsx
│   │   ├── LoadingSpinner.jsx
│   │   ├── MuteButton.jsx
│   │   └── transitions/
│   │       ├── GameIntro.jsx
│   │       ├── ZoomOverlay.jsx
│   │       └── variants/
│   │           └── FadeSettleIntro.jsx
│   ├── transitions/               # route-launch transitions (distinct from ui/transitions)
│   │   ├── FadeLaunch.jsx
│   │   └── GameLaunch.jsx
│   └── games/
│       ├── GameCard.jsx
│       ├── GameCarousel.jsx
│       ├── GameShape.jsx
│       ├── _shared/
│       │   ├── heatGauge.js
│       │   ├── roundedPolyPath.js
│       │   ├── roundedNgonPath.js     # orphaned? see D1
│       │   └── synergy.js
│       ├── square/
│       │   ├── SquareGame.jsx
│       │   ├── SquareCanvas.jsx
│       │   ├── StrokeSelector.jsx
│       │   ├── CompletionScreen.jsx
│       │   ├── SquareCardPreview.jsx
│       │   └── strokes/
│       │       ├── stampStroke.js     # Classic (default)
│       │       └── layeredWash.js     # Watercolor
│       ├── hexagon/
│       │   ├── HexagonGame.jsx
│       │   ├── HexagonCanvas.jsx
│       │   └── HexagonCardPreview.jsx
│       ├── infinity/
│       │   ├── InfinityGame.jsx
│       │   ├── InfinityCanvas.jsx
│       │   └── InfinityCardPreview.jsx
│       └── dragon/
│           └── DragonGame.jsx
└── pages/
    ├── LandingPage.jsx
    ├── DemoPage.jsx
    ├── LoginPage.jsx
    ├── SignupPage.jsx
    ├── OnboardingPage.jsx
    ├── HomePage.jsx
    ├── DashboardPage.jsx
    ├── AccountPage.jsx
    ├── PrivacyPage.jsx
    ├── TermsPage.jsx
    └── games/
        ├── SquarePage.jsx
        ├── HexagonPage.jsx
        ├── InfinityPage.jsx
        └── DragonPage.jsx

public/
├── assets/
│   ├── dragon-spike.riv
│   ├── fingerprint.png
│   └── fingerprintDark.png
├── sounds/
│   ├── squareGameAmbience.mp3
│   └── hexGameAmbience.mp3
└── textures/
    ├── track-dirt.svg
    └── meadow-ground.svg
```

*Note: `public/favicon.ico` and `public/og-image.png` are documented in the old tree but not present on disk — add or drop.*
