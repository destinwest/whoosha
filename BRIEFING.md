# WHOOSHA — Claude Code Project Briefing
> Read this file at the start of every session. Reference specific sections by name when asking for help.

---

## 1. App Concept

**Whoosha** is a web application that helps elementary-aged children (ages 5–12) regulate their nervous systems through interactive, multisensory breathing games. The name evokes the sound and feeling of a calming breath.

Children trace illustrated shapes on the screen with their finger, following a guided breathing pattern. Visual feedback, audio cues (todo), and gentle on-screen encouragement guide the user. The experience is tactile, calming, and designed to work even when a child is dysregulated or distressed.

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
| **Stripe (Test Mode)** | Simulated payments | Use test card 4242 4242 4242 4242. No real money. Simulate free + paid tier access |

### Pre-Launch (Do Not Build Yet — but write forward-compatible code)
- Vercel (hosting, replaces local dev server)
- Cloudflare (domain + DNS + WAF)
- Stripe Live Mode (real payments)
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

### 6.0 Pre-Game Intro Screen (Shared — All Games)

Every game session begins with this intro screen, regardless of which game is being launched. It plays every time the child enters a game. A skip button is always available for children who have done it before.

**Purpose:** Guide the child through one complete breath before the game begins. Grounds an activated or distressed child before asking them to engage with the tracing mechanic.

**Background start:** Deep forest green `#2C4A3E`

**Sequence:**
1. **Text phase (4 seconds total):**
   - Dark deep forest green `#2C4A3E` appears immediately
   - Line 1 fades in immediately: "Ready to begin?" (0.5s fade)
   - Line 2 fades in starting at 2 seconds over 2 seconds, fully solid at 4s: "Let's take one good breath together"
   - Both lines centered, large, Nunito semibold, warm white
   - Text fades out over the final 1 second of the inhale phase, fully gone at peak brightness

2. **Breath animation (8 seconds total), begins immediately after text phase:**
   - **Inhale — 4 seconds:** Background/fullscreen brightens from deep forest green `#2C4A3E` to off-white cream `#F5EFE6`. Text is gone by the end of this phase.
   - **Exhale — 4 seconds:** The overlay fades from opacity 1 to 0 while holding color `#F5EFE6`, revealing the game canvas below
   - Transition is a smooth JS interpolation using `requestAnimationFrame` — not a CSS transition or flash

3. **Handoff:** COMMENT - Does this instruction makes sense, or do the rest of the instructions already ensure a smooth handoff? After the full intro sequence, the intro fades out and the game canvas fades in automatically with a 0.5 second opacity transition.

**Skip button:** Small, low-contrast "skip" text link, bottom right corner, visible throughout. Tapping it jumps immediately to the game canvas.

**Implementation:** Implement as a React state phase `'intro'` that precedes `'game'`. The intro is a full-screen `<div>` — not part of the canvas. Use `performance.now()` and `requestAnimationFrame` for the brightness interpolation timing.

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
- **Minimal header:** App logo centered or left. Small parent/account icon top right only. No other navigation visible.
- **Greeting:** Large, warm, rounded text. E.g. "Hi Lily 🌿" using the active child's first name. Pulled from Supabase. Centered below header.
- **Game cards grid:** 2x2 grid on tablet, 2x2 on phone (scrollable if needed), single column on very small screens. Each card:
  - Large rounded rectangle, minimum 180px tall, generous padding
  - Soft background color from soothing palette — one card per color (sage green, teal, lavender, amber)
  - Simple illustrated shape icon centered (square, infinity, hexagon, flower)
  - Game name in large rounded font below icon: **Square Breathing, Infinity Breathing, Hexagon Breathing, Flower Breathing**
  - One short line of description ("Trace the square and breathe")
  - Entire card is tappable — large touch target
- **Bottom of screen:** Only if needed — small parent icon to access dashboard. No other navigation.
- **Inactive games** (not yet built): Show card in muted/desaturated state with small lock icon. Still tappable but shows gentle "coming soon" message rather than navigating.

---

### 6.4 Square Breathing Game Page (`/games/square`)
**Audience:** Child (immersive)  
**Goal:** Child traces the square path and breathes at a calm, guided pace  
**Background:** Eucalyptus sage `#9FBFB4` — static throughout, does not change during exercise  
**Feel:** All interface disappears. Only the game exists.

**Intro screen:** Every game session begins with the shared Pre-Game Intro Screen defined in Section 6.0. Apply it here exactly as specified.

---

#### Game Canvas

- **Exit button only:** Arrow. Tappable at all times. Returns to `/home`. No label needed.

- **Shape — Rhomboid Path:**
  The path is NOT a traditional sharp-cornered square. It is a thick, heavily rounded square path — like a rounded square with very large corner radii. Reference `design-assets/boxBreathingGame.png` closely.
  - Stroke width: approximately 6mm in physical size — scale this relative to screen DPI. On a standard tablet this is roughly 22–26px. The stroke is thick enough that a child's finger fits comfortably within it.
  - Corner radius: very large — approximately 15–20% of the side length. The corners are nearly semicircular, not subtle rounding. The result looks like a smooth square track, not a square with clipped corners.
  - The stroke itself has two visible edges — an inner rail and an outer rail — because of its thickness.
  - **Base color: off-white cream `#F5EFE6`** — the full path starts in this color before the child has traced anything. This is the untraced state.
  - The shape takes up approximately 60–70% of the screen width, centered.
  - Side labels (Breathe In — bottom side, Hold — right side, Breathe Out — top side, Hold — left side) are drawn centered on the path, overlaid on the centerline midpoint of each side.

- **Start circle:**
  Large amber pulsing circle `#D4A056` positioned at the bottom-left of the path — exactly as shown in `design-assets/boxBreathingGame.png`. The circle sits on the path itself, overlapping the stroke. It pulses gently with a soft glow to invite touch. Label: "start" in small, soft, muted text inside the circle. This is the child's finger target to begin.

---

#### Start State (Pre-Trigger)

This is the exact visual state when the game canvas first appears — after the intro screen, before the child has touched anything — and the state the game returns to when the stroke style is changed.

- **Racetrack:** full cream `#F5EFE6`, no painted color anywhere
- **Pacing circle:** white circle, visible, stationary at the bottom-left start point
- **Pacing circle state:** stationary, not yet triggered
- **Amber user circle:** sitting at the same bottom-left start point, on top of and overlapping the pacing circle. Displays "start" label in small, soft, muted text. Pulse ring animation active.
- **Lap counter:** 0, lap color index 0 (sage green `#7DB89A` will be the first color painted)
- **Labels:** all four side labels visible (breathe in, hold, breathe out, hold)

The child places their finger on the amber circle and begins dragging to trigger the game. The moment dragging begins: pacing circle starts moving, "start" label is removed from the amber circle, and the amber circle becomes the trace circle following the finger. The pulse ring animation on the amber circle stops once triggered.

**Reset to start state** (on stroke style change): stop and return the pacing circle to the start point, return the amber circle to the start point with "start" label and pulse ring restored, clear all paint canvases, reset lap counter to 0 and lap color index to 0, freeze/hide the trace circle. Do not replay the intro screen.

---

- **Pacing circle:**
  A larger circle in soft white. Visible at the start point (bottom-left) before the child touches anything — it sits at the start position, stationary, slightly behind the amber start circle. Once the child touches and begins dragging the amber circle, the pacing circle starts moving and travels the full path continuously — 4 seconds per side — with smooth movement through corners at consistent speed, no pausing. Once started, it never stops and is never affected by the child's finger. Loops indefinitely until the child exits.

- **Child's trace/Amber user circle:**
  Amber circle `#D4A056` that follows the child's finger, projected onto the nearest point on the path centerline. The child tries to keep their circle on top of the pacing circle. No penalty, no feedback text — the pacing circle is the only guide. When the child lifts their finger, the trace circle freezes at its last position. It does not disappear and does not move until the child touches the screen again.

- **Stroke painting mechanic — the core visual:**
  As the child's trace circle moves along the path, it paints the stroke with the current lap color. The cream base `#F5EFE6` is replaced by the lap color exactly where the child has traced. Untraced portions remain cream.

  **Lap color sequence** — calming, perceptually adjacent transitions:
  ```
  Lap 1: Soft sage green    #7DB89A
  Lap 2: Muted teal         #5B9FAA
  Lap 3: Dusty lavender     #9B8FC4
  Lap 4: Pale periwinkle    #8BA7C7
  Lap 5+: sequence repeats from Lap 1
  ```
  Colors are calming — blues, greens, purples predominantly. Each color is perceptually adjacent to its neighbor — no sudden jumps.

  **Persistence:**
  - If the child lifts their finger mid-lap, painted portions stay exactly as-is
  - When they return their finger to the path, painting resumes from where their finger lands
  - The pacing circle continues independently regardless of whether the child is actively tracing

- **Encouragement moment:**
  When the pacing circle completes a lap and the child's trace circle is within **60px of the pacing circle** at that moment (meaning the child was closely following the pace), show a brief gentle encouragement:
  - Soft radial glow pulses once from the center of the shape
  - Text "Beautiful work 🌟" fades in at the middle of the shape, then fades out over 2 seconds
  - Game continues uninterrupted — pacing circle does not pause
  - **This moment only triggers on the first qualifying lap.** After it fires once, it will not fire again until at least 30 seconds have elapsed. After 30 seconds, it becomes eligible to trigger again on the next qualifying lap.
  - Implementation: on each lap completion, calculate pixel distance between trace circle position and pacing circle position. If distance ≤ 60px AND `now - lastEncouragementTime > 30_000`, show encouragement and set `lastEncouragementTime = performance.now()`.

- **No completion state.** The game runs indefinitely. The child exits via the exit button when ready.

- **Session save:** When the child taps the exit button, write to Supabase `sessions` table: `child_id`, `game_slug: 'square-breathing'`, `duration_seconds` (time from game start to exit tap), `completed: true`.

**Square Breathing Timing (one full lap = 16 seconds):**

The path is traced counterclockwise starting at the bottom-left corner. Each side carries its own breathing instruction. Corners are simply turning points — no pause. The breathing phase transitions the moment the corner is reached.

```
Side 1 (bottom-left → bottom-right):  Breathe IN   — 4 seconds
Side 2 (bottom-right → top-right):    HOLD         — 4 seconds
Side 3 (top-right → top-left):        Breathe OUT  — 4 seconds
Side 4 (top-left → bottom-left):      HOLD         — 4 seconds
```

**Corner behavior:** No pause at corners. The pacing dot advances smoothly through corners without stopping. Phase label fades in slightly before the new side begins.

**Implementation notes:**
- Use React `useRef` and `requestAnimationFrame` for all animation — no React state updates inside the animation loop
- Use an HTML `<canvas>` element with a React ref for the game canvas
- Game state phases: `'intro' | 'game'` — no completion state
- **Racetrack path geometry:** draw using Canvas 2D `roundRect()` or `arcTo()`. Corner radius approximately 18% of the shorter side length. Stroke width `Math.round(devicePixelRatio * 22)` pixels.
- **Stroke painting:** an offscreen canvas stores all painted color. On each pointer move, draw a line segment from the previous to the current projected position at full track width, clipped to the annular track region. Composite order each frame: cream base path → paint canvas → labels → pacing circle → amber circle. Painting is permanent — lifted fingers do not erase. See Visual Polish section for full stroke rendering specs.
- **Lap detection:** detect lap completion when the child's trace circle crosses back over the start point (bottom-left) in the counterclockwise direction. On lap completion, increment lap counter, switch to next color in sequence using `currentLap % colors.length`.
- **Lap color array:** `['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7']` — index with modulo for infinite looping.
- **Encouragement timing:** on each lap completion, calculate pixel distance between trace circle and pacing circle. If distance ≤ 60px AND `now - lastEncouragementTime > 30000ms`, show encouragement and set `lastEncouragementTime = performance.now()`.
- **Pacing circle:** driven entirely by `performance.now()`. Loops indefinitely. No user input affects timing.
- **Child's trace circle:** driven by `onTouchMove` / `onMouseMove`. Projects finger onto nearest path centerline point.
- **Phase determination:** derived from pacing circle's current side index (0 = bottom = Breathe In, 1 = right = Hold, 2 = top = Breathe Out, 3 = left = Hold).
- **Game start trigger:** at start state, the pacing circle is visible but stationary at the start point. The game begins (pacing circle starts moving) when the child's finger touches within ~40px of the start point and begins dragging. Timer starts on trigger.
- **Session save on exit:** capture `performance.now()` at game start and at exit button tap to calculate `duration_seconds`.
- **Canvas sizing:** recalculate all geometry on resize using `ResizeObserver`.

---

#### Visual Polish — Square Breathing Game

These are the required visual quality standards for the game canvas. They are not optional enhancements — they define what the finished game should look like. All effects use Canvas 2D API only. No CSS filters, no external libraries.

**Guiding principle:** Every element should feel dimensional and alive, not flat. The stroke rendering is the primary visual — it must feel organic and hand-painted, not like a cursor trail.

---

**1. Paint Layer — Default Stroke**

The default stroke is rendered on a persistent offscreen canvas that is composited onto the display canvas each frame. Paint is permanent — lifting the finger does not erase it.

- Each pointer move event draws a line segment from the previous projected position to the current one using `ctx.lineTo` + `ctx.stroke`
- `lineWidth` equals the full track width (`lw`), `lineCap` is `'round'`
- The stroke is clipped to an annular region (outer roundRect minus inner roundRect, `evenodd` fill rule) so paint can never bleed outside the track boundaries
- Color interpolates smoothly between the current lap color and the next lap color based on the finger's progress through the lap (`to.fraction / 4`), so color transitions continuously rather than jumping at lap boundaries
- Lap color sequence: `['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7']`, cycling with modulo

---

**1b. Paint Layer — Watercolor Stroke (Selectable Alternative)**

The layered wash stroke is an alternative rendering mode selectable from the stroke style menu (see Stroke Style Selector below). It produces a softer, more painterly watercolor quality by maintaining multiple independent drawing layers simultaneously.

**Architecture — multiple offscreen canvases:**
Each layer has its own offscreen canvas. Layers are composited back-to-front onto the display canvas each frame. This is architecturally different from the default stroke — do not attempt to replicate the effect with a single canvas at reduced opacity.

**Layer parameters (3 layers by default, outermost first):**
- Layer 0 (outer): width = `baseWidth × 1.8`, opacity = `~0.09` — wide, very faint wash, most positional jitter
- Layer 1 (middle): width = `baseWidth × 1.2`, opacity = `~0.28` — medium wash
- Layer 2 (inner): width = `baseWidth × 0.65`, opacity = `~0.55` — narrow, most opaque core, follows true path exactly

**Independent point buffers with jitter:**
Each layer maintains its own point history. Outer layers apply random positional jitter (2–3px) to each incoming point before storing it. This causes each layer to trace a slightly different curve — the result reads as organic depth rather than concentric rings at different opacities.

**Catmull-Rom smoothing + adaptive subdivision** apply identically to the default stroke. Velocity response (width and opacity) applies to all layers simultaneously using the innermost layer's velocity reading.

**Compositing:** draw layer 0 first (widest/faintest), then layer 1, then layer 2 on top. All layers use the current lap color.

---

**Stroke Style Selector**

A small stroke style selector lives in the top-right corner of the game screen, accessible at all times during play. It allows the child (or parent) to switch between available stroke rendering modes.

**Behavior:**
- Displayed as a compact icon button (paintbrush icon) in the top-right corner, alongside the exit button in the top-left
- Tapping it opens a small floating panel with two options: **Classic** (default tapered stroke) and **Watercolor** (layered wash stroke)
- The currently active stroke is indicated with a subtle highlight or checkmark
- Switching takes effect immediately on the next drawn stroke — the game is reset to the 'start state.'
- The selected stroke style is session-only — it does not persist between sessions. The default is always Classic on session start.
- The panel closes automatically after a selection is made, or when the child taps anywhere outside it

**Implementation:**
- Implement as `StrokeSelector.jsx` in `src/components/games/square/`
- Stroke mode is stored in a React ref (not state) to avoid triggering re-renders inside the animation loop: `strokeModeRef = useRef('classic')`
- The two rendering implementations live in separate files: `src/components/games/square/strokes/taperedStroke.js` and `src/components/games/square/strokes/layeredWash.js`
- Each stroke module exports a consistent interface: `init(ctx, config)`, `addPoint(x, y, vel)`, `render()`, `clear()`
- `SquareCanvas.jsx` imports both and delegates to whichever `strokeModeRef.current` points to

**Visual design of the selector panel:**
- Small floating card, softly rounded, semi-transparent dark background (`rgba(44,74,62,0.85)`)
- Two options displayed as labeled rows with a small stroke preview swatch
- Nunito semibold, warm white text, no harsh borders
- Tap target minimum 44px tall per row

---

**2. Encouragement Moment — Pulse**

- Pulse: amber `rgba(212,160,86,...)`, existing behavior, faster fade.

Pulse animate using `t = (now - enc.startTime) / 2000` (0→1). 

"Beautiful work 🌟" text: add a very soft `ctx.shadowBlur = 8` / `ctx.shadowColor = 'rgba(255,255,255,0.6)'` behind the text to make it feel luminous rather than flat.

---

**3. Paint Luminosity Progression**

Each successive lap's paint should feel very slightly more luminous — as if the track is gradually brightening as the child breathes more calmly. Implement as a `globalAlpha` increase on the core paint pass only:

```
const coreAlpha = Math.min(0.95, 0.80 + lapColorIdxRef.current * 0.04)
```

The progression is subtle — imperceptible lap to lap, but noticeable across a full session. Cap at 0.95 so it never becomes fully opaque.

---
**TODO - when polish steps are complete, rewrite this order list**
**DO NOT REFERENCE THIS LIST NOW - IT IS JUST A PLACE HOLDER**
<!-- **Drawing Order (complete, authoritative)**

Every frame must draw in exactly this order:
1. `clearRect` — full canvas
2. Vignette gradient — full canvas rect
3. Racetrack shadow pass — `lw + 4`, dark tint
4. Racetrack cream pass — `lw`, `#F5EFE6`
5. Racetrack highlight pass — `lineWidth 2`, bright rim
6. Paint canvas composite — `ctx.drawImage(paintCanvas, 0, 0, W, H)`
7. Labels — `drawLabels()`
8. Pacing circle — frosted glass gradient + shadow
9. Amber circle — gem gradient + existing pulse rings
10. Encouragement glow — outer sage pulse, inner amber pulse, luminous text

Do not deviate from this order. Any element drawn out of sequence will produce incorrect compositing. -->

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
- Background color shifts during game exercises — backgrounds are static

---

## 8. Landing Page Demo Animation Spec

The auto-playing Square Breathing demo on the landing page is a looping CSS or React animation — not interactive. Clicking it navigates to `/demo`.

**Animation behavior:**
- A rhomboid-shaped path identical to the game version (thick stroke, heavily rounded corners, cream base color `#F5EFE6`) renders centered in the right column of the hero
- A glowing amber dot traces the perimeter of the path continuously, **counterclockwise starting from the bottom-left** — matching the actual game direction
- As the dot travels, it **paints the stroke with the current lap color** — the cream path fills in behind the dot exactly as it does in the real game. The painted color stays; it does not fade or reset mid-lap.
- On each full loop, the stroke color transitions to the next lap color (starting from where the dot is), cycling through the lap color sequence: `#7DB89A → #5B9FAA → #9B8FC4 → #8BA7C7` and repeating
- Phase label text fades in alongside the relevant side: "Breathe in" bottom, "Hold" right, "Breathe out" top, "Hold" left
- Loop duration: approximately 16 seconds (4 sides × 4 seconds)
- Subtle pulsing glow effect on the amber dot
- No sound

**Implementation:** Use a React component with `requestAnimationFrame` to drive the dot position and paint the SVG or canvas stroke progressively. The stroke painting effect should use `stroke-dashoffset` on an SVG path or canvas arc drawing — filling in the stroke segment by segment behind the dot. On lap completion, switch stroke color for subsequent segments.

---

## 9. Project Folder Structure

```
whoosha/
├── .env                          # Never commit this
├── .env.example                  # Commit this — shows required variables without values
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── BRIEFING.md                   # This file
├── design-assets/                # Color palette images, reference screenshots
│   ├── palette-backgrounds.png
│   ├── palette-text-info.png
│   ├── palette-soothing-rewarding.png
│   ├── palette-blues.png
│   ├── palette-greens.png
│   └── boxBreathingGame.png      # Visual reference for square breathing game shape
├── public/
│   ├── favicon.ico
│   └── og-image.png              # Social sharing image placeholder
└── src/
    ├── main.jsx                  # App entry point
    ├── App.jsx                   # Router setup
    ├── index.css                 # Tailwind base + global styles
    ├── lib/
    │   ├── supabaseClient.js     # Supabase initialization
    │   └── stripe.js             # Stripe initialization (test mode)
    ├── store/
    │   └── useStore.js           # Zustand store — auth, active child, game state
    ├── hooks/
    │   ├── useAuth.js            # Auth state hook
    │   └── useSession.js         # Game session tracking hook
    ├── components/
    │   ├── layout/
    │   │   ├── Navbar.jsx        # Landing page nav (logged out)
    │   │   ├── AppNav.jsx        # App nav (logged in, minimal)
    │   │   └── Footer.jsx
    │   ├── ui/
    │   │   ├── Button.jsx        # Reusable button component
    │   │   ├── Card.jsx          # Reusable card component
    │   │   └── LoadingSpinner.jsx
    │   └── games/
    │       └── square/
    │           ├── SquareGame.jsx         # Main game component, manages 'intro' | 'game' phases
    │           ├── SquareCanvas.jsx       # Canvas drawing logic, delegates to active stroke module
    │           ├── PacingCircle.jsx       # Pacing circle timing and movement logic
    │           ├── IntroScreen.jsx        # Pre-game intro breath animation (shared pattern)
    │           ├── StrokeSelector.jsx     # Top-right stroke style picker UI
    │           └── strokes/
    │               ├── taperedStroke.js   # Default stroke: Catmull-Rom + tapered polygon fill
    │               └── layeredWash.js     # Alternative stroke: multi-layer watercolor wash
    └── pages/
        ├── LandingPage.jsx
        ├── LoginPage.jsx
        ├── SignupPage.jsx
        ├── OnboardingPage.jsx     # Child name capture, first login only
        ├── HomePage.jsx           # Game selection
        ├── DashboardPage.jsx      # Stub
        ├── AccountPage.jsx        # Stub
        └── games/
            └── SquarePage.jsx     # Game page wrapper
```

---

## 10. Environment Variables

Create a `.env` file in the project root with these values. Never commit `.env` — only commit `.env.example`.

```
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe (Test Mode only for MVP)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here

# Sentry
VITE_SENTRY_DSN=your_sentry_dsn
```

---

## 10b. Tailwind Color Token Configuration

Extend `tailwind.config.js` with these named tokens so colors are used as clean class names throughout the codebase rather than arbitrary values. This is required — do not skip.

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-cream':          '#F1E3C6',
        'bg-rose':           '#EDE8DF',
        'bg-mint':           '#DFF0E6',
        'bg-eucalyptus':     '#9FBFB4',  // Game home + all game screens
        // Text
        'text-forest':  '#3E5E52',
        'text-sage':    '#6D9B8A',
        'text-purple':  '#5F5476',
        'text-mauve':   '#8E7A9B',
        // Actions + Accents
        'primary':      '#4A9B7F',
        'secondary':    '#5B9FAA',
        'accent-lavender': '#9B8FC4',
        'accent-amber': '#D4A056',
        // Blues (selective use)
        'blue-navy':    '#1F234A',
        'blue-slate':   '#404371',
        'blue-steel':   '#687495',
        'blue-powder':  '#B0C5DD',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body:    ['Nunito', 'sans-serif'],
      },
      borderRadius: {
        'xl':  '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
    },
  },
}
```

---

## 10c. Tier Definitions (Free vs Paid)

Used by Stripe test mode access checks and the pricing section on the landing page.

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

**Access check logic:** On the game home page, read `profiles.tier` from Supabase for the logged-in parent. If `tier === 'free'`, show Square Breathing as active and all other game cards as locked. If `tier === 'paid'`, show all cards as active. This is a simple client-side check for MVP — server-side enforcement comes pre-launch.

---

## 11. Typography

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

## 12. Design Principles (Apply to Every Screen)

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

## 13. MVP Definition

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
- [ ] Stripe test mode integration (simulated free vs paid tier access check)
- [ ] Zustand store for auth state and active child
- [ ] Sentry error monitoring initialized
- [ ] GitHub repository with clean commit history
- [ ] `.env` configuration for all secrets

### Explicitly Out of Scope for MVP
- Real payments (Stripe test mode only)
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

## 14. How to Start Each Claude Code Session

At the beginning of each new Claude Code session, say:

> "Please read BRIEFING.md in the project root before we begin."

Claude Code will read the file using its file tools. Then tell it which section is most relevant to the current task. For example:
- "We're building the Landing Page. Refer to Section 6.1 and Section 7 for color."
- "We're implementing the Square Breathing game. Refer to Section 6.4 for full specs."
- "We're setting up Supabase. Refer to Section 4 for the schema."

This ensures every session starts with full context without re-explaining the project from scratch.

---

## 15. Whoosha Brand Voice

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

---

<!--
## 16. Nature Trace Game — Full Spec
⚠️ THIS SECTION IS COMMENTED OUT — FOR FUTURE REFERENCE ONLY.
Claude Code should not read or build anything in this section.
Uncomment when ready to build the Nature Trace game.
-->

<!--

**Route:** `/games/nature-trace`
**Game slug:** `nature-trace`
**Unlock tier:** Paid
**Estimated play time:** ~5 minutes per picture
**Audience:** Child (immersive, same rules as Square Breathing game page)

---

### 16.1 Concept

The child traces a sequence of line segments that together form a nature scene. At any given moment they are zoomed in close enough to see only the active segment they are tracing, set against a soft nature-textured background. They cannot see the full picture. When all segments are complete, the view slowly zooms out to reveal the whole image — which progressively fills with color as it appears.

The reveal is the emotional payoff. The tracing is the regulation mechanic.

---

### 16.2 The Picture — A Whale

The first Nature Trace picture is a **humpback whale** — a large, smooth, rounded creature made entirely of flowing curved lines. A whale is ideal for this game because:
- Its outline is made of long, graceful curves with no sharp angles — natural for slow tracing
- It is universally recognizable even from a partial reveal
- It carries an inherently calming, oceanic association that reinforces the breathing mechanic
- It fills a roughly square canvas naturally

The whale is defined as an ordered array of segments. Each segment has a start point, end point (or control points for curves), a breathing instruction, and a pacing duration. The full image is drawn on a virtual canvas of 1000×1000 units — all coordinates are in this space and scaled to the device at render time.

---

### 16.3 Segment Data Structure

Each segment in the picture is defined as a JavaScript object:

```js
{
  id: 1,
  type: 'quadratic',        // 'line' | 'quadratic' | 'cubic'
  from: [x, y],             // start point in 1000x1000 space
  control1: [x, y],         // for quadratic curves
  control2: [x, y],         // for cubic curves only
  to: [x, y],               // end point
  breath: 'in',             // 'in' | 'hold' | 'out' | 'hold'
  duration: 4,              // seconds for pacing circle to travel this segment
  strokeColor: '#5B9FAA',   // color of the line when traced
  fillRegion: null,         // null or region id — used for color fill on reveal
}
```

The full segment array for the whale picture is defined in `src/games/nature-trace/whaleSegments.js`. This file is the content layer — changing it produces a different picture without touching any game logic.

---

### 16.4 Breathing Pattern

Uses the same four-phase box breathing pattern as Square Breathing, assigned per segment:

```
Segment breath: 'in'    → "Breathe in"   — child inhales while tracing
Segment breath: 'hold'  → "Hold"         — child holds while tracing
Segment breath: 'out'   → "Breathe out"  — child exhales while tracing
Segment breath: 'hold'  → "Hold"         — child holds while tracing
```

Segments cycle through IN → HOLD → OUT → HOLD → IN → HOLD → OUT → HOLD in order regardless of segment length. Longer segments get longer durations (up to 6 seconds). Shorter segments use 4 seconds. The breathing instruction label is shown below the active segment during tracing.

---

### 16.5 Camera and Zoom System

This is the most technically complex part of the game. The camera system must:

**During tracing (zoomed in):**
- Calculate a viewport rectangle that frames the active segment with generous padding on all sides — approximately 2× the segment length in both dimensions
- The segment is centered in the viewport
- Scale the canvas so this viewport fills the screen
- Apply a CSS `transform: scale() translate()` or canvas transform matrix to achieve this — do not re-render the full canvas on every frame, apply a transform to the existing canvas

**Between segments (transition):**
- When the pacing circle completes the current segment and the child lifts their finger, a 2.5 second animated transition begins
- The camera smoothly pans and rescales from the current viewport to the viewport of the next segment
- Use a CSS transition or `requestAnimationFrame` lerp on the transform values — not a jump cut
- During the transition, a soft breathing cue appears: "Take a breath" in large gentle text, fading in and out
- The next segment's start circle appears and pulses once the transition settles, inviting the child to place their finger

**On reveal:**
- When the final segment is complete, the camera animates over 4 seconds from whatever the final viewport was back to the full 1000×1000 canvas fitting the screen
- Use a slow ease-out curve so the deceleration feels satisfying
- Once fully zoomed out, trigger the color fill animation (see Section 16.7)

---

### 16.6 Zoomed-In View — What the Child Sees

While tracing a segment the child sees:

- **Background:** A soft nature texture — a gentle watercolor-style wash in pale mint and soft teal tones. This is a static image asset placed behind the canvas. It does not move with the camera — it stays fixed and the canvas content moves over it. This grounds the experience in a nature aesthetic even before the picture is revealed.
- **Previously completed segments:** Rendered on the canvas in their stroke colors at full opacity. They are visible but not highlighted — they recede into the composition naturally.
- **Active segment:** Rendered as a slightly thicker stroke in soft teal `#5B9FAA`. A pulsing amber start circle `#D4A056` marks where the child should place their finger.
- **Pacing circle:** Small white circle traveling the active segment at the defined duration. Appears once the child touches the start circle.
- **Child's trace circle:** Larger amber circle following the child's finger, projected onto the active segment path.
- **Fading trail:** Soft coral trail behind the child's trace circle, fading over 2 seconds.
- **Breathing instruction text:** Large, soft, centered text at the bottom of the screen. Driven by the current segment's breath assignment.
- **Progress indicator:** A very subtle row of small dots at the top of the screen — one dot per segment, filled as each is completed. Small enough to not distract, present enough to give a sense of progress through the picture.
- **Exit button:** Top left, always visible.

---

### 16.7 The Reveal — Color Fill Animation

When the camera finishes zooming out to the full picture:

1. The complete whale outline is visible in its stroke color on the pale mint background
2. Over approximately 6 seconds, color washes into each fill region of the whale progressively — not all at once, but region by region from the largest areas inward, like watercolor soaking into paper
3. Fill colors are soft, muted, nature-inspired:
   - Whale body: deep teal-blue `#3A7A8A` with a soft gradient toward `#5B9FAA` at the edges
   - Belly: warm cream `#F1E3C6`
   - Fins: slightly darker teal `#2E6A78`
   - Eye: deep forest `#3E5E52` with a tiny cream highlight
   - Background ocean wash: pale mint `#DFF0E6` deepening toward `#B0C5DD` at the edges
4. The fill uses canvas `fillStyle` with low-opacity layered passes to simulate a watercolor effect — not a flat color dump
5. Once fill is complete, a 1.5 second pause, then the completion UI fades in gently over the picture

**Completion UI (overlaid on the revealed picture):**
- Semi-transparent dark overlay at the very bottom of the screen only — does not cover the whale
- "You made this 🐋" in large Fraunces display font
- Two buttons side by side: "Draw again" (resets and replays from segment 1) and "All done" (returns to `/home`)
- No other UI — let the picture breathe

---

### 16.8 Segment Transition — Between Lines

When the pacing circle reaches the end of a segment:
- The next segment does not appear immediately
- A 2.5 second gap occurs during which the camera transitions (see Section 16.5)
- During this gap, the child's trace circle disappears and the completed segment glows softly for 1 second before settling to its resting stroke color
- The breathing cue "Take a breath 🌿" appears centered on screen in large soft text
- The next start circle fades in at the start point of the next segment once the camera settles

If the child has not completed tracing the current segment when the pacing circle finishes, the next segment still begins — the child's pace does not gate the game's progression. Only the pacing circle determines timing. This is identical to the Square Breathing mechanic.

---

### 16.9 Implementation Notes

**Canvas architecture:**
- Use a single `<canvas>` element sized to the screen
- Maintain two canvas contexts if needed — one for the background picture (all completed segments + active segment outline) and one for the animation layer (pacing circle, trace circle, trail). Compositing two canvases is cleaner than managing z-order within one.
- All coordinates are stored in 1000×1000 space and converted to screen pixels via a single scale factor: `scaleFactor = Math.min(screenWidth, screenHeight) / 1000`

**Curve rendering:**
- Use `ctx.quadraticCurveTo()` and `ctx.bezierCurveTo()` for curved segments
- Projecting a point onto a Bezier curve for the trace circle requires parameterizing the curve — use a lookup table of ~100 points per segment computed once at game load, then find the nearest point via distance comparison on each touch event

**Camera transform:**
- Store camera state as `{ x, y, scale }` where x/y is the canvas coordinate at the center of the viewport and scale is the zoom level
- On each animation frame, apply `ctx.setTransform(scale, 0, 0, scale, -x * scale + screenWidth/2, -y * scale + screenHeight/2)` before drawing
- Lerp between camera states during transitions using `performance.now()` for timing

**Segment file — `src/games/nature-trace/whaleSegments.js`:**
Claude Code should generate a complete, carefully designed whale outline using approximately 16–20 segments that:
- Form a closed, recognizable humpback whale silhouette when viewed together
- Are ordered so each segment connects to the next (end point of segment N = start point of segment N+1)
- Cycle through IN / HOLD / OUT / HOLD breathing assignments
- Have durations that total approximately 280–320 seconds (roughly 5 minutes) including transition gaps
- Are defined in 1000×1000 coordinate space with the whale centered around [500, 500]

**Session save:** On completion, write to Supabase `sessions` table with `game_slug: 'nature-trace'`, `duration_seconds`, `completed: true`.

---

### 16.10 Claude Code Prompt — Building the Nature Trace Game

Use this prompt when ready to build this game:

```
Build the Nature Trace game at /games/nature-trace. Read Section 16 of BRIEFING.md 
in full before writing any code — there are multiple subsections that all matter.

Start with:
1. The whale segment data file at src/games/nature-trace/whaleSegments.js — design 
   a complete humpback whale outline of 16-20 connected segments in 1000x1000 
   coordinate space, cycling through IN/HOLD/OUT/HOLD breathing assignments, 
   with total durations of approximately 300 seconds including transitions

2. The camera system — viewport calculation, smooth transitions between segments, 
   and the final zoom-out reveal animation

3. The canvas rendering — background texture layer, completed segments, active 
   segment, pacing circle, trace circle, and fading trail

4. The color fill reveal animation — watercolor-style progressive fill by region

5. The completion UI — overlaid on the revealed picture per Section 16.7

6. Session save to Supabase on completion

Reference Section 6.4 for the box breathing game as a model for the canvas 
architecture and pacing circle mechanic — the core tracing interaction is identical, 
extended here with a camera system and reveal.
```

---

*Last updated: layered wash stroke added as selectable alternative, stroke selector menu specified, visual polish section updated (removed vignette/gem/frosted glass, kept encouragement pulse and luminosity progression), folder structure updated for stroke modules, start state section added to Section 6.4, pacing circle and trace circle descriptions corrected*
*Prepared for use with Claude Code*
