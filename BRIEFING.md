# WHOOSHA — Claude Code Project Briefing
> Read this file at the start of every session. Reference specific sections by name when asking for help.

---

<!--
  FOR DESTIN — What this file is and how to use it

  This file is Claude Code's memory of the project. Its job is to give Claude
  enough context at the start of any session to make good decisions without you
  having to re-explain everything from scratch.

  What belongs here:
    - What the app is and who it's for
    - Architectural rules and file ownership boundaries
    - Visual and behavioral intent — what things should feel like, not how to code them
    - Color system, typography, design principles
    - Screen-by-screen layout specs (the what, not the how)
    - Key decisions and the reasoning behind them

  What does NOT belong here:
    - Implementation code, formulas, or function signatures — those go in session files
    - Tuning constants and specific pixel values — those live in the code itself
    - Step-by-step instructions for Claude Code — those go in session instruction files

  Workflow:
    1. Ideate — decide what you want, talk it through here if needed
    2. Update the briefing — record the what and why
    3. Write a session instruction file — the precise how, consumed once then archived
    4. Claude Code executes — reads briefing for context, session file for instructions
    5. Iterate — tuning changes go in the code, not back in the briefing
-->

---

## 1. App Concept

**Whoosha** is a web application that helps elementary-aged children (ages 5–12) regulate their nervous systems through interactive, multisensory breathing games. The name evokes the sound and feeling of a calming breath.

Children trace illustrated shapes on the screen with their finger, following a guided breathing pattern. Visual feedback, adaptive audio, and gentle on-screen encouragement guide the user. The experience is tactile, calming, and designed to work even when a child is dysregulated or distressed.

**The core insight driving the design:** Research shows that combining tactile interaction, geometric tracing, and paced breathwork is one of the most effective nervous system regulation techniques for children. The app makes this accessible and engaging without requiring adult instruction during use.

**The target problem:** A parent whose child is in a nervous system crisis — anxious, overwhelmed, mid-meltdown — needs to hand them something that works immediately, with zero friction and zero explanation required.

---

## 2. Target Users

### Primary User: Parent (Account Holder)
- Adult, typically a parent or caregiver of an elementary-aged child
- First encounters Whoosha on the landing page while researching tools for their child
- Creates and manages the account, adds child profiles, reviews progress
- May be stressed or time-pressured when opening the app
- Needs: trust, clarity, speed, and evidence that this is safe and science-backed

### Secondary User: Child (Game Player)
- Age 5–12, likely in an activated or dysregulated nervous system state when using the app
- May be unable to read well, follow complex instructions, or exercise patience
- Needs: immediate visual clarity, zero cognitive load, soothing colors, large touch targets, and intuitive flow
- Should be able to select and play a game independently once the parent has set up the account

### Device Usage (in order of frequency)
1. **Tablet** — primary target device, most common usage
2. **Phone** — secondary, must work well
3. **Desktop** — least common, must be functional but not the design focus

### Design Rule
Every screen must answer the question **"what do I do next?"** within two seconds. This is non-negotiable for the child-facing screens and strongly preferred everywhere else.

---

## 3. Tech Stack

### Frontend (Build Now — MVP)
| Tool | Role | Notes |
|------|------|-------|
| **React 18** | UI framework | All screens, components, game interactions |
| **Vite** | Dev server + build tool | Local dev on localhost:5173, fast HMR |
| **React Router v6** | Navigation | Page routing + protected routes (logged-in only) |
| **Tailwind CSS** | Styling | Utility-first, responsive, all visual styling |
| **Zustand** | State management | Auth state, active child profile, game session state |
| **GitHub** | Version control | Commit early and often, main + dev branches |
| **Sentry** | Error monitoring | Catches crashes during local testing sessions |

### Backend Services (MVP — connect to these now)
| Service | Role | Notes |
|---------|------|-------|
| **Supabase Auth** | Authentication | Email/password + Google OAuth. Local dev uses Supabase local or cloud free tier |
| **Supabase DB** | PostgreSQL database | Parent profiles, child profiles (first name only), session history |

Tier access for MVP is a client-side check against `profiles.tier` (see Section 11). No payment processor is wired in the MVP.

### Pre-Launch (Do Not Build Yet — but write forward-compatible code)
- Vercel (hosting, replaces local dev server)
- Cloudflare (domain + DNS + WAF)
- Stripe (payments — both test and live mode deferred to pre-launch)
- Resend (transactional email)
- Staging environment
- PostHog (analytics)
- Security hardening (CSP headers, rate limiting)

### Future Phases (Awareness Only — do not build)
- Redis cache (Upstash)
- CMS (Contentful or Sanity)
- Email marketing (ConvertKit)
- Push notifications (OneSignal)
- Gamification engine
- School/org tier
- Biofeedback (wearable API)
- Native app (React Native/Expo)
- Next.js migration for SEO

### Version Control
- Use GitHub from day one
- `.env` file for all API keys and config — never hardcode secrets
- `.gitignore` must exclude `.env`, `node_modules`, and any sensitive files
- Folder structure must be clean and scalable from the start (see Section 9)

---

## 4. Supabase Database Schema

### Table: `profiles` (parent accounts)
```sql
id          uuid references auth.users primary key
email       text
full_name   text
tier        text default 'free'  -- 'free' or 'paid'
created_at  timestamptz default now()
```

### Table: `children`
```sql
id          uuid primary key default gen_random_uuid()
parent_id   uuid references profiles(id) on delete cascade
first_name  text  -- ONLY data stored about the child
created_at  timestamptz default now()
```

### Table: `sessions`
```sql
id           uuid primary key default gen_random_uuid()
child_id     uuid references children(id) on delete cascade
game_slug    text  -- e.g. 'square-breathing'
duration_seconds  integer
completed    boolean default false
created_at   timestamptz default now()
```

### COPPA Note
Store **only** the child's first name. No email, no date of birth, no photo, no device identifiers linked to the child. The parent account owns all data. Row Level Security must be enabled on all tables — parents can only read/write their own data.

---

## 5. Site Structure and Screen Inventory

```
whoosha.com/              → Landing Page (public, parent audience)
whoosha.com/demo          → Interactive Demo Page (public, tryable game)
whoosha.com/login         → Login Page (public)
whoosha.com/signup        → Sign Up Page (public)
whoosha.com/onboarding    → Child Profile Setup (protected, first login only)
whoosha.com/home          → Game Selection Home (protected, child-friendly)
whoosha.com/games/square  → Square Breathing Game (protected, immersive)
whoosha.com/dashboard     → Parent Dashboard (protected, parent audience)
whoosha.com/account       → Account Settings (protected, parent audience)
```

### MVP Scope — Build These
- Landing Page (`/`)
- Login Page (`/login`)
- Sign Up Page (`/signup`)
- Onboarding Screen (`/onboarding`)
- Game Selection Home (`/home`)
- Square Breathing Game (`/games/square`)

### Post-MVP — Stub Routes Only
- Demo Page (`/demo`) — public interactive preview of Square Breathing, no login required. For MVP, this can be a minimal version of the game page with a banner saying "Sign up to save your progress." Clicking the demo animation on the landing page navigates here.
- Parent Dashboard (`/dashboard`) — stub with placeholder UI
- Account Settings (`/account`) — stub with placeholder UI

---

## 6. Screen-by-Screen Layout Specifications

---

### 6.0 Pre-Game Intro System (Shared — All Games)

Every game session begins with an intro sequence before the game canvas is revealed. The intro system is designed to be modular — multiple intro variants exist, each suited to a different child state or context. The active variant is passed as a prop at the game level.

**Purpose:** Create a felt sense of threshold — the child crosses from the ordinary world into a calm, living game world. The intro should lower arousal, not instruct. No text, no breathing prompts, no cognitive demands.

**Architectural approach:** The intro system lives in `src/components/ui/transitions/` as a shared, game-agnostic component. It is not embedded inside any individual game folder. Any game can use any intro variant by name. `SquareGame.jsx` receives an `introVariant` prop (defaulting to `'fadeSettle'`) and passes it to the shared `<GameIntro>` wrapper component. The `'intro' | 'game'` phase state remains in `SquareGame.jsx` — the transition component calls `onComplete` when finished, triggering the phase change.

**The game canvas is always mounted and running during the transition** — pacing circle already moving before the child sees anything. The intro reveals a living world, not a static one.

**Skip:** A small low-contrast `›` glyph, bottom-right corner, always visible. Tapping it calls `onComplete` immediately and snaps all animations to their end state.

---

#### Intro Variant: `fadeSettle` (current default)

**Concept:** A dark forest green overlay fades away to reveal the game world underneath. As the color lifts, the world comes gradually into focus, then gently settles into place. Three sensations arrive in sequence — light, clarity, stillness — each with its own moment.

**The game canvas is running throughout.** The pacing circle is already mid-lap when the overlay begins to lift.

**Sequence and timing:**

```
0.15s   Overlay fade begins       — opacity 1→0 over 1.8s, cubic-bezier(0.4, 0, 0.2, 1)
1.2s    Blur begins clearing      — blur 7→0 over 1.6s, ease-out-soft
1.5s    Scale begins settling     — scale 1.05→1.0 over 1.4s, ease-out-quart
~2.9s   All three land together   — onComplete fires
```

**Overlay:** Full-screen `div`, `background: #2C4A3E`, fades via CSS transition. Color chosen to match the home screen background so the transition reads as the world brightening, not one screen replacing another.

**Blur:** Applied as `filter: blur()` on the scene container — GPU-accelerated, smooth. Starts at 7px, clears continuously to 0. Blur begins while the color is still fading, so focus and color arrive as overlapping sensations rather than sequential steps.

**Scale:** Scene container holds at `scale(1.05)` during the color fade, then settles to `scale(1.0)`. Uses a quartic ease-out — fast initial movement with a long imperceptible tail — so the world feels like it is settling into place rather than snapping to a stop. Scale and blur finish within a fraction of a second of each other, so focus and stillness arrive as a single feeling.

**Handoff:** Once all animations complete, `onComplete` fires. The overlay and transition component unmount. `SquareGame.jsx` transitions to `'game'` phase.

---

#### Future intro variants (not yet built)

The intro system is designed to support additional variants over time, each suited to a different child state or emotional context. The variant used for a given session can eventually be selected based on child state, time of day, or parent preference. All variants share the same `onComplete` / `onSkip` interface and the same rule: the game canvas is always running underneath before the reveal begins.

---

### 6.1 Landing Page (`/`)
**Audience:** Parent
**Goal:** Communicate trust, explain the product, and convert to sign up
**Background:** Warm cream `#F1E3C6`
**Feel:** Calm, editorial, modern wellness brand — not childish

**Layout:**
- **Sticky top navigation bar:** Logo (left), three nav links center (How It Works, For Parents, Pricing), Login and Sign Up buttons (right). Sign Up button uses primary green `#4A9B7F`. Thin, unobtrusive bar.
- **Hero section:** Two-column layout. Left: headline value proposition + subheadline + Sign Up CTA button. Right: auto-playing animated game demo (Square Breathing shape tracing itself on a loop — see Section 8 for animation spec). Warm cream background. Generous padding.
- **Science section:** Single column, centered. Brief explanation of the nervous system regulation research behind the app. Two or three short paragraphs. Forest green `#3E5E52` headings, sage body text.
- **Features section:** Three cards in a row. Each card: illustrated icon, short headline, one sentence description. Cards use soft background tones from the backgrounds palette, rounded corners, no harsh borders.
- **Pricing preview section:** Simple two-column tier comparison. Free tier vs Paid tier. Clean, honest, no dark patterns.
- **Final CTA section:** Full-width band in pale mint `#DFF0E6`. Large headline, Sign Up button, one line of reassurance text ("No credit card required for free tier").
- **Footer:** Minimal. Logo, Privacy Policy link, Terms of Service link, copyright. Dark forest green `#3E5E52` background, light text.

**Typography:** Rounded serif or soft display font for headlines (suggest Fraunces or DM Serif Display from Google Fonts). Clean sans-serif for body (Nunito or DM Sans). Never use Inter, Roboto, or Arial.

---

### 6.2 Login Page (`/login`) and Sign Up Page (`/signup`)
**Audience:** Parent
**Goal:** Get logged in or create account with minimum friction
**Background:** Full page pale mint `#DFF0E6` — signals transition into the app
**Feel:** Minimal, focused, nothing competing for attention

**Layout:**
- No navigation bar. Logo only, top left, links back to `/`
- Centered card, white or very light cream, heavily rounded corners, generous padding, soft shadow
- App logo at top of card
- Headline: "Welcome back" (login) or "Create your account" (signup)
- OAuth buttons stacked vertically: **Google only for MVP** — full-width rounded button with Google icon and label. Facebook/Meta and Apple OAuth require additional developer account setup and cost — add post-MVP.
- Thin divider with centered "or" text
- Email input field
- Password input field
- Primary action button (Log In / Create Account) in `#4A9B7F`
- Below card: small text link — "Don't have an account? Sign up" or vice versa
- **No other content on the page.** No marketing copy, no navigation links, no footer.

---

### 6.3 Game Selection Home (`/home`)
**Audience:** Child (with parent setup complete)
**Goal:** Child selects a breathing game to play — as fast and clear as possible
**Background:** Eucalyptus sage `#9FBFB4`
**Feel:** Welcoming, calm, child-appropriate — soothing and rewarding palette dominates

**Layout:**
- **Minimal header:** App logo top-left, small parent/account menu top-right (opens to Dashboard / Log out).
- **Greeting:** Large, warm, rounded text. E.g. "Hi Lily 🌿" using the active child's first name. Pulled from Supabase. Centered below header.
- **Fanned game-card carousel:** Eight cards arranged in a fan, one active in the center, others rotated behind. Implemented in `src/components/games/GameCarousel.jsx`. Roster and order in `src/data/games.js`:
  - Positions −3, −2: "more breath soon" placeholders (locked, frosted, three-dot mystery shape)
  - Position −1: Infinity Breathing (locked, frosted)
  - Position 0 (center, default active): **Square Breathing** (only free-tier game)
  - Position +1: Hexagon Breathing (locked, frosted)
  - Position +2: Flower Breathing (locked, frosted)
  - Positions +3, +4: "more breath soon" placeholders (locked, frosted)
- **Card visual:** 200×280px rounded rectangle. Per-game gradient background. Shape icon centered, game name and tagline below. Locked cards have a frosted-glass filter (`blur(2px) saturate(0.55)`) plus a small lock badge in the top-right corner.
- **Last-viewed card persists** across navigation within a session via `homeActiveCardIndex` in the Zustand store. Defaults to Square on first load.

**Interaction:**
- **Touch-primary devices (phones and tablets):** swipe left/right to rotate the fan. Tap a side card to bring it to center. Tap the center card to enter (if unlocked) or show the "Coming Soon" overlay (if locked). Chevron buttons are hidden via `(hover: none) and (pointer: coarse)` media query.
- **Desktop (mouse-primary):** chevron buttons (`‹` / `›`) flank the carousel. Arrow keys also rotate. Click a side card to bring it to center. Click the center card to enter the game. Enter key activates the centered card.
- **Coming Soon overlay:** Tapping the active card while it's locked shows a translucent overlay with "Coming Soon" text. Auto-dismisses after ~1.4s; click anywhere on the overlay to dismiss earlier.

**Fan geometry** (tunable constants in `GameCarousel.jsx`):
- Cards pivot around a point 380px below their center.
- Rotation: 11° per step from center; up to ±44° at distance 4.
- Scale: drops 0.05 per step, floor 0.80.
- Z-index decreases with distance from center.
- Cards beyond distance 4 (currently none) fade to opacity 0.

---

### 6.4 Square Breathing Game Page (`/games/square`)
**Audience:** Child (immersive)
**Goal:** Child traces the square path and breathes at a calm, guided pace
**Background:** Eucalyptus sage `#9FBFB4` — a subtle diagonal gradient (lighter sage top-left, darker sage bottom-right), with optional texture and lighting per `POLISH-STRATEGY.md`. Static — does not shift with lap state.
**Feel:** All interface disappears. Only the game exists.

**Intro screen:** Every game session begins with the shared Pre-Game Intro Screen defined in Section 6.0. Apply it here exactly as specified.

---

#### Game Canvas

- **Exit button only:** Arrow. Tappable at all times. Returns to `/home`. No label needed.

- **Shape — Rounded Square Path:**
  The path is NOT a traditional sharp-cornered square. It is a thick, heavily rounded square path — like a rounded square with very large corner radii. Reference `design-assets/boxBreathingGame.png` closely.
  - Stroke width: approximately 6mm in physical size — scale this relative to screen DPI. On a standard tablet this is roughly 22–26px. The stroke is thick enough that a child's finger fits comfortably within it.
  - Corner radius: very large — approximately 15–20% of the side length. The corners are nearly semicircular, not subtle rounding. The result looks like a smooth square track, not a square with clipped corners.
  - The stroke itself has two visible edges — an inner rail and an outer rail — because of its thickness.
  - **Base color: off-white cream `#F5EFE6`** — the full path starts in this color before the child has traced anything. This is the untraced state.
  - The shape takes up approximately 60–70% of the screen width, centered.
  - Side labels (Breathe In — bottom side, Hold — right side, Breathe Out — top side, Hold — left side) are drawn centered on the path, overlaid on the centerline midpoint of each side.

- **Start circle:**
  Amber pulsing circle `#D4A056` positioned at the bottom-left of the path. The circle sits on the path centerline, overlapping the stroke. It pulses gently with a soft glow to invite touch. Label: "start" in small, soft, muted text inside the circle. This is the child's finger target to begin.

  **Sizing:** radius = `lw * 0.35` where `lw` is the track stroke width in CSS px. Scales automatically with screen size.

---

#### Start State (Pre-Trigger)

This is the exact visual state when the game canvas first appears — after the intro screen, before the child has touched anything — and the state the game returns to when the stroke style is changed.

- **Racetrack:** full cream `#F5EFE6`, no painted color anywhere
- **Pacing circle:** white circle, visible, stationary at the bottom-left start point
- **Amber user circle:** sitting at the same bottom-left start point, on top of and overlapping the pacing circle. Displays "start" label in small, soft, muted text. Pulse ring animation active.
- **Lap counter:** 0, lap color index 0 (sage green `#7DB89A` will be the first color painted)
- **Labels:** all four side labels visible

The child places their finger on the amber circle and begins dragging to trigger the game. The moment dragging begins: pacing circle starts moving, "start" label is removed from the amber circle, and the amber circle becomes the trace circle following the finger. The pulse ring animation stops once triggered.

**Reset to start state** (on stroke style change): stop and return the pacing circle to the start point, return the amber circle to the start point with "start" label and pulse ring restored, clear all paint canvases, reset lap counter to 0 and lap color index to 0. Do not replay the intro screen.

---

- **Pacing circle:**
  A larger circle in soft white. Visible at the start point before the child touches anything — stationary, slightly behind the amber start circle. Once the child touches and begins dragging, the pacing circle starts moving and travels the full path continuously — 4 seconds per side — with smooth movement through corners at consistent speed, no pausing. Once started, it never stops and is never affected by the child's finger. Loops indefinitely until the child exits.

- **Child's trace / Amber user circle:**
  Amber circle `#D4A056` — same radius as the start circle — that follows the child's finger within a lateral travel band around the path centerline. The child tries to keep their circle on top of the pacing circle. No penalty, no feedback text — the pacing circle is the only guide. When the child lifts their finger, the trace circle freezes at its last position.

  **Travel band:** the finger is clamped within ±`travelPx` (`lw * 0.15`) of the centerline, measured perpendicularly. The child can drift slightly inward or outward but never outside the track boundary.

  **Projection:** find the nearest point on the centerline (`clPoint`) and apply a clamped lateral offset along the path normal to get the final amber circle position. Use the clamped position — not `clPoint` — as both the amber circle center and the paint stroke origin.

  **Lap detection and encouragement** use `clPoint` only — lateral drift does not affect either.

- **Stroke painting mechanic — the core visual:**
  As the child's trace circle moves along the path, it paints the stroke with the current lap color. The cream base `#F5EFE6` is replaced by the lap color exactly where the child has traced. Untraced portions remain cream. Paint is permanent — lifted fingers do not erase.

  **Lap color sequence** — calming, perceptually adjacent transitions:
  ```
  Lap 1: Soft sage green    #7DB89A
  Lap 2: Muted teal         #5B9FAA
  Lap 3: Dusty lavender     #9B8FC4
  Lap 4: Pale periwinkle    #8BA7C7
  Lap 5+: sequence repeats from Lap 1
  ```

  **Paint luminosity:** each successive lap's paint feels very slightly more luminous — as if the track gradually brightens as the child breathes more calmly. Subtle and imperceptible lap to lap, but noticeable across a full session.

- **Encouragement moment:**
  When the pacing circle completes a lap and the child's trace circle is within 60px (longitudinal path distance) of the pacing circle at that moment, show a brief gentle encouragement:
  - Soft radial glow pulses once from the center of the shape
  - Text "Beautiful work 🌟" fades in at the middle of the shape, then fades out over 2 seconds. Text has a very soft luminous glow behind it.
  - Game continues uninterrupted
  - Triggers only once per qualifying lap, with a minimum 30-second cooldown between triggers
  - Lateral drift is ignored — this is a path-distance check only

- **No win/lose state.** The game loop runs indefinitely — there is no scoring, failure, or forced end. The child exits via the exit button when ready; on exit, a gentle session-end card summarizes the session before returning home.

- **Session save:** When the child taps the exit button, write to Supabase `sessions` table: `child_id`, `game_slug: 'square-breathing'`, `duration_seconds`, `completed: true`.

**Square Breathing Timing (one full lap = 16 seconds):**

The path is traced counterclockwise starting at the bottom-left corner. Each side carries its own breathing instruction. Corners are simply turning points — no pause.

```
Side 1 (bottom-left → bottom-right):  Breathe IN   — 4 seconds
Side 2 (bottom-right → top-right):    HOLD         — 4 seconds
Side 3 (top-right → top-left):        Breathe OUT  — 4 seconds
Side 4 (top-left → bottom-left):      HOLD         — 4 seconds
```

**Corner behavior:** No pause at corners. The pacing dot advances smoothly through corners without stopping. Phase label fades in slightly before the new side begins.

---

#### Component Architecture — File Ownership Boundary

`SquareGame.jsx` owns all React state and orchestration: game phase (`'intro' | 'game'`), active stroke style, `handleStrokeSelect`, session timing, exit handling, and the `introVariant` prop (default `'fadeSettle'`). It renders the shared `<GameIntro>` transition component during the intro phase and `<SquareCanvas>` + `<StrokeSelector>` during the game phase. It knows nothing about canvas drawing, geometry, or intro animation internals.

`SquareCanvas.jsx` owns everything canvas-related: the `<canvas>` element, the `requestAnimationFrame` loop, all geometry computation and caching, the offscreen paint canvas and its clip path, all per-frame draw calls, pointer event handling, projection logic, lap detection, and encouragement timing. It receives `strokeModeRef` (a React ref) from `SquareGame.jsx` as a prop. It exposes an imperative `reset()` method via `useImperativeHandle` + `forwardRef`.

**Rule:** If it touches a canvas context or geometry → `SquareCanvas.jsx`. If it touches React state or UI outside the canvas → `SquareGame.jsx`.

Key constraints:
- All animation via `useRef` + `requestAnimationFrame` — no React state updates inside the animation loop
- All geometry recalculated on resize via `ResizeObserver`
- Paint canvas permanently clipped to the annular track region — paint can never bleed outside the track
- Pacing circle driven entirely by `performance.now()` — never affected by user input
- `strokeModeRef` lives in `SquareGame.jsx`, passed as a prop, read directly in the animation loop

---

#### Visual Polish — Square Breathing Game

**Guiding principle:** Every element should feel dimensional and alive, not flat. The stroke rendering is the primary visual — it must feel organic and hand-painted, not like a cursor trail.

Visual technique, iOS perf budget, and rules about CSS filters / SVG / layering live in `POLISH-STRATEGY.md`. This section describes design intent; that doc describes how to achieve it.

**Background:** A subtle diagonal gradient (top-left lighter sage to bottom-right darker sage) with optional baked texture and lighting. Static — does not shift with lap state.

**Vignette:** A subtle radial darkening that pushes the centered track forward perceptually. Sits above the game canvas; its center is transparent so on-canvas elements (encouragement message, pacing circle) read clearly.

**Racetrack surface:** Composed of four layered passes to create the illusion of a slightly raised physical channel — a convex surface with a lit inner lip and a shadowed inner wall:
- Pass A: outer shadow — anchors the track with a soft drop shadow
- Pass B: gradient body — main cream surface simulating a curved raised surface lit from above. Gradient cached per resize.
- Pass C: highlight rim — very thin bright stroke simulating reflected light on the raised inner lip
- Pass D: inner wall shadow — faint dark stroke simulating the inner wall casting shadow into the channel

**Visual stacking (back to front):**
1. Background — gradient, textures, lighting (baked once at resize)
2. Racetrack surface — outer shadow, gradient body, highlight rim, inner wall shadow
3. Painted stroke — child's traced color, clipped to track
4. Labels (DOM overlay)
5. Pacing circle
6. Amber / trace circle
7. Vignette (CSS overlay)
8. Encouragement overlay (when active)

Static layers are baked at resize; dynamic layers render per-frame. See `POLISH-STRATEGY.md` for the rendering pipeline and per-frame budget.

**Paint layer — default stroke ("Classic"):** A persistent offscreen canvas composited each frame. Rendered via stamp-based drawing — radial-gradient stamps placed along the centerline at fixed spacing, with a soft leading edge and subtle rail-edge accumulation. Color drifts continuously over time, interpolating between lap colors. Implementation in `strokes/stampStroke.js`. Clipped to annular track region.

**Paint layer — watercolor stroke (selectable):** An alternative rendering mode producing a softer, more painterly quality. Uses multiple independent offscreen canvases composited back-to-front. Each layer has its own point history with slight positional jitter on outer layers, creating organic depth. Includes velocity response (faster movement = thinner, more transparent stroke) and wet edge effect (darker pigment at stroke boundary). Texture grain is implemented but disabled by default. All tuning constants live at the top of `layeredWash.js`.

**Stroke Style Selector:** A small paintbrush icon button in the top-right corner. Tapping opens a floating panel with two options: Classic and Watercolor. Switching resets the game to start state. Session-only — always defaults to Classic on load. Implemented as `StrokeSelector.jsx`. Stroke mode stored as a ref in `SquareGame.jsx`, passed to `SquareCanvas.jsx` as a prop.

---

#### Heat Gauge

An accumulating effect over the first six laps that mirrors how consistently the child stays with the pacing circle. If they hold steady, the world remains vivid and the stroke maintains full body. If they drift off-pace, paint gradually drains from the track, the stroke thins, and the world desaturates — felt feedback that pace and presence are slipping.

The intent is not punishment. The intent is felt feedback: the visual state mirrors the regulation state. A child returning to pace can see the color come back. The effect caps at lap 6 — by then the child is either with the pacing circle or has chosen to pause/exit.

Implementation details (saturation curve, paint-drain mechanism, stroke-thinning behavior) live in the code and `POLISH-STRATEGY.md`.

---

### 6.5 Onboarding Screen (`/onboarding`)
**Audience:** Parent (first login only)
**Goal:** Capture child's first name before entering the app
**Background:** Eucalyptus sage `#9FBFB4`
**Trigger:** Redirect here automatically after first login if no rows exist in the `children` table for this parent. Never show again once a child profile exists.

**Layout:**
- No navigation. Logo only, top center.
- Single centered card, same style as login card
- Warm, welcoming headline: "Who are we breathing with today?"
- Single text input: "Child's first name" — large, rounded, easy to tap
- Note below input in small sage text: "We only store their first name. Nothing else."
- Continue button in `#4A9B7F` — full width of card
- On submit: create row in `children` table with `parent_id` and `first_name`, then redirect to `/home`

**This is the entire screen.** One question. One input. One button.

---

### 6.6 Parent Dashboard (`/dashboard`) — Stub Only for MVP
**Audience:** Parent
**Background:** Rose neutral `#EDE8DF`
**Feel:** Mature, trustworthy, clean data presentation

Build a placeholder page with:
- The same sticky navigation as the landing page (logged-in state)
- A heading: "Your Dashboard"
- A simple card showing the child's name and a note: "Progress tracking coming soon"
- Navigation links to Account Settings

Full dashboard to be built post-MVP. Data schema is already in place to support it.

---

## 7. Color System

### Usage Rules
Apply colors according to their designated role. Do not swap categories.

### Background Colors
Used for page and section backgrounds. Never for text or interactive elements.
```
#F1E3C6  Warm Cream        → Landing page, marketing sections
#EDE8DF  Rose Neutral      → Parent dashboard, account pages
#DFF0E6  Pale Mint         → Login/signup pages
#9FBFB4  Eucalyptus Sage   → Game Selection Home (/home) and all game screens
```

Game backgrounds use `#9FBFB4` exclusively — not pale mint. This provides sufficient tonal range for the intro screen breath animation to feel meaningful without being overstimulating.

### Text and Informational Colors
Used for headings, body text, labels, and informational UI.
```
#3E5E52  Forest Green    → Primary headings, nav links, strong text
#6D9B8A  Sage            → Secondary text, descriptions, captions
#5F5476  Deep Purple     → Category labels, callouts (use sparingly on body text — check contrast)
#8E7A9B  Soft Purple     → Tertiary labels, fine print accents
```

### Soothing and Rewarding (Action + Accent Colors)
Used for buttons, interactive elements, progress trails, rewards, and game cards.
```
#4A9B7F  Sage Green      → Primary action color (CTA buttons, Sign Up, primary interactions)
#5B9FAA  Soft Teal       → Secondary interactive elements, game card backgrounds
#9B8FC4  Lavender        → Creative exercises, reward moments, secondary accents
#D4A056  Warm Amber      → Encouragement moments, celebration, start circle, trace circle
```

### Blues (Inspiration + Selective Use)
Not primary colors. Use selectively for trust signals on parent-facing pages.
```
#1F234A  Deep Navy       → Footer background only
#404371  Slate Purple    → Avoid on child-facing screens
#687495  Steel Blue      → Parent dashboard secondary elements
#B0C5DD  Powder Blue     → Soft backgrounds in parent sections, subtle dividers
```

### Never Use
- Pure white `#FFFFFF` as a background — use cream, mint, or eucalyptus sage instead
- Pure black `#000000` as text — use `#3E5E52` forest green instead
- Saturated bright reds, oranges, or yellows as dominant colors
- High-contrast harsh color combinations on child-facing screens
- Page/CSS background color shifts during game exercises — the HTML background is always static eucalyptus sage. Note: the game canvas draws animated gradients and lap-color tints on top of this static background — that is intentional and not a violation of this rule.

---

## 8. Landing Page Demo Animation Spec

The auto-playing Square Breathing demo on the landing page is a looping React animation — not interactive. Clicking it navigates to `/demo`.

**Animation behavior:**
- A rounded square path identical to the game version (thick stroke, heavily rounded corners, cream base color `#F5EFE6`) renders centered in the right column of the hero
- A glowing amber dot traces the perimeter of the path continuously, counterclockwise starting from the bottom-left — matching the actual game direction
- As the dot travels, it paints the stroke with the current lap color — the cream path fills in behind the dot exactly as it does in the real game. The painted color stays; it does not fade or reset mid-lap.
- On each full loop, the stroke color transitions to the next lap color, cycling through `#7DB89A → #5B9FAA → #9B8FC4 → #8BA7C7` and repeating
- Phase label text fades in alongside the relevant side: "Breathe in" bottom, "Hold" right, "Breathe out" top, "Hold" left
- Loop duration: approximately 16 seconds (4 sides × 4 seconds)
- Subtle pulsing glow effect on the amber dot
- No sound

---

## 9. Folder Conventions

This section describes *where things go and why* — the conventions a new file must follow. It is not a file inventory; for the current file list, read the tree directly (`ls`, or your editor). Keeping this as conventions rather than a mirror is deliberate: a mirror drifts every commit, conventions don't.

**Repo root** holds the three living docs — `BRIEFING.md` (product/design intent, WHAT + WHY), `CLAUDE.md` (session operating instructions), `POLISH-STRATEGY.md` (visual technique + iOS perf, HOW) — plus standard Vite config (`index.html`, `package.json`, `vite.config.js`, `tailwind.config.js`), `design-assets/` for visual reference imagery, and `docs/future/` for parked specs that shouldn't add reading weight to every session. Never commit `.env`; commit `.env.example`.

**`public/`** is static assets served as-is: `assets/` for binary game assets (Rive files, hint glyphs), `sounds/` for sampled atmospheric beds (see `POLISH-STRATEGY.md` for the samples-vs-synthesis rule), `textures/` for static SVGs that get baked into game canvases at resize.

**`src/` layering** — keep responsibilities in their layer; don't reach across:
- `lib/` — third-party client setup (Supabase, etc.). `store/` — the single Zustand store. `data/` — static content/config (e.g. the carousel roster). `hooks/` — reusable stateful logic; every data fetch goes through a hook, never directly in a page.
- `sound/` — the adaptive audio system: one `SoundDirector` owning the AudioContext + bus spine, plus per-element synth modules. Game canvases feed it per-frame state via a hook; canvases never touch the AudioContext directly.
- `pages/` — one component per route, thin. A page under `pages/games/` is just a wrapper that mounts the corresponding game component; all game logic lives in the component, not the page.
- `components/` — grouped by role: `auth/`, `layout/`, `ui/` (generic reusable primitives), and `games/`.

**Two transition folders, deliberately distinct:** `components/ui/transitions/` holds *intro / threshold* transitions (the pre-game reveal, §6.0). `components/transitions/` holds *route-launch* transitions (home-card → game). Don't merge them; they run at different moments and have different owners.

**The per-game folder pattern** (`components/games/<name>/`) is the most important convention — every new game follows it:
- `<Name>Game.jsx` — React orchestration: phase/state, stroke/mode selection, session timing, exit. Owns everything *outside* the canvas.
- `<Name>Canvas.jsx` — all canvas work: geometry, the `requestAnimationFrame` loop, pointer input, paint, lap/segment detection. Owns everything a canvas context or geometry touches. (This ownership split is the hard rule in §6.4 — honor it in every game.)
- `<Name>CardPreview.jsx` — the carousel preview render for that game.
- Game-specific subfolders as needed (e.g. Square's `strokes/` for selectable paint styles).

Anything shared across games lives in `games/_shared/` (cross-game geometry, heat-gauge, synergy logic) or, for the card UI, in the top-level `games/` helpers (`GameCard`, `GameCarousel`, `GameShape`). Rule of thumb: if a second game would need it, it belongs in `_shared/`, not in a game folder.

---

## 10. Environment Variables

Create a `.env` file in the project root with these values. Never commit `.env` — only commit `.env.example`.

```
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Sentry
VITE_SENTRY_DSN=your_sentry_dsn
```

---

## 11. Tier Definitions (Free vs Paid)

Defines the client-side tier gating (reads `profiles.tier`) and the pricing section on the landing page. Payment processing is deferred to pre-launch.

| Feature | Free Tier | Paid Tier |
|---------|-----------|-----------|
| Square Breathing game | ✅ | ✅ |
| Infinity Breathing game | ❌ | ✅ |
| Hexagon Breathing game | ❌ | ✅ |
| Flower Breathing game | ❌ | ✅ |
| Session history (last 7 days) | ✅ | ✅ |
| Full session history + progress charts | ❌ | ✅ |
| Multiple child profiles | ❌ (1 child) | ✅ (up to 5) |
| Parent dashboard | Basic stub | Full |

**Access check logic:** On the game home page, read `profiles.tier` from Supabase for the logged-in parent. If `tier === 'free'`, show Square Breathing as active and all other game cards as locked. If `tier === 'paid'`, show all cards as active. Simple client-side check for MVP — server-side enforcement comes pre-launch.

---

## 12. Typography

### Font Pairing
- **Display/Headline font:** Fraunces (Google Fonts) — rounded, organic, warm. Use for all H1 and H2 headings on the landing page and game home screen.
- **Body font:** Nunito (Google Fonts) — rounded, clean, highly readable for children. Use for all body text, labels, game instructions, and UI elements.
- **Never use:** Inter, Roboto, Arial, or any geometric corporate sans-serif.

### Font Sizes (Tailwind)
- Game instruction text (child reads during exercise): `text-3xl` minimum on tablet
- Game feedback text: `text-xl`
- Card labels on home screen: `text-lg`
- Body text on landing page: `text-base`
- Fine print, captions: `text-sm`

### Rounded Text
All text in the app should feel soft. Use `font-weight: 600` (semibold) rather than bold for headings to maintain the rounded, approachable feel without visual aggression.

---

## 13. Design Principles (Apply to Every Screen)

1. **One clear action per screen.** Every screen has a single most-important thing a user should do. Make it obvious through size, color, and placement.

2. **Cognitive load is the enemy.** Especially on child-facing screens. If something can be removed, remove it. If something can be simplified, simplify it.

3. **Color communicates emotion.** Follow the color system strictly. The research behind these color choices is real — the palette isn't aesthetic preference, it's therapeutic intent.

4. **Large touch targets always.** Minimum 44px touch target on all interactive elements. Prefer larger — 60-80px for primary game interactions and card taps.

5. **Never re-excite a regulated nervous system.** No confetti, no flashing, no loud celebration animations. Reward moments should be gentle, warm, and brief.

6. **Rounded everything.** Corners, buttons, cards, avatars, text. Sharp angles are visually stimulating and create tension. The entire app should feel soft to look at.

7. **White space is calming.** Generous padding and margins at all times. Never pack elements together. If a screen feels crowded, it needs more space, not smaller elements.

8. **The interface disappears during games.** Once a child starts a game, the only visible UI is the exit button and the game itself. Everything else hides.

9. **Forward-compatible architecture.** Write clean, modular code. Every component should be usable in isolation. Every data fetch should go through a dedicated hook or service layer — not directly in page components.

10. **Accessibility from day one.** All interactive elements need aria labels. Color contrast must meet WCAG AA minimum. Font sizes must be readable without zooming. These are not optional.

---

## 14. MVP Definition

**MVP = a locally hosted web app that friends and family can test on your home network.**

### In Scope for MVP
- [ ] Landing page with auto-playing square breathing demo animation (painting mechanic)
- [ ] Login page with email/password + Google OAuth (Supabase Auth)
- [ ] Sign up page with email/password + Google OAuth
- [ ] Protected routing (redirect to login if not authenticated)
- [ ] Onboarding screen (`/onboarding`) — child name capture on first login
- [ ] Game selection home page showing all four game cards (three locked/coming soon)
- [ ] Square Breathing game — pre-game intro screen, painting mechanic, pacing circle, encouragement moment, indefinite play, session save on exit
- [ ] Greeting with child's first name on home screen
- [ ] Parent dashboard stub page
- [ ] Account settings stub page
- [ ] Client-side free/paid tier gating from `profiles.tier` (no payment processor)
- [ ] Zustand store for auth state and active child
- [ ] Sentry error monitoring initialized
- [ ] GitHub repository with clean commit history
- [ ] `.env` configuration for all secrets

### Explicitly Out of Scope for MVP
- Payments (Stripe / any processor) — deferred to pre-launch
- Email verification (can be disabled in Supabase for local testing)
- Transactional email (Resend not needed yet)
- Progress charts or detailed analytics on dashboard
- Multiple child profiles (support one child per account for now)
- Additional games (Infinity, Hexagon, Flower — stub cards only)
- Admin dashboard
- COPPA legal pages (needed before public launch, not for home testing)
- SEO, OG tags, sitemap
- Performance optimization and caching

---

## 15. Session Setup

Claude Code auto-loads `CLAUDE.md` at the start of every session. That file directs Claude to read this briefing and `POLISH-STRATEGY.md` as appropriate to the task — no manual setup needed.

When kicking off a task, point Claude to the most relevant section:
- "We're building the Landing Page. Refer to Section 6.1 and Section 7."
- "We're working on the Square Breathing game. Refer to Section 6.4."
- "We're setting up Supabase. Refer to Section 4."

---

## 16. Whoosha Brand Voice

Use this tone in all in-app copy, labels, feedback messages, and marketing text.

- **Calm but not sleepy.** Warm but not saccharine. Encouraging but not performative.
- **Simple words.** If a 6-year-old can't understand it, rewrite it.
- **Never clinical.** This is not a medical app. Never use words like "therapy," "treatment," "diagnose," or "disorder."
- **Nature metaphors.** Breathe like the wind. Calm like still water. Steady like a tree.
- **Second person for children.** "You're doing great 🌊" not "The user has completed the exercise."
- **Avoid AI-sounding phrases.** No "Certainly!", no "Great job!", no "As an AI...". Write like a kind, patient human.

### Sample In-App Copy
- Game instruction: "Breathe in slowly as you trace this side..."
- Encouragement moment: "Beautiful work! Your body is feeling calmer now."
- Home greeting: "Hi Lily! Which game would you like to play?"
- Error message: "Something went a little sideways. Let's try again."
- Intro screen: "Before we begin... Let's take one slow breath together"

---

<!--
Parked future games (Nature Trace, etc.) live under docs/future/ — kept out of this
file so they don't add reading weight to every session. When one is greenlit, move its
intent back here as a new §6 game screen. See docs/future/nature-trace.md.
-->
