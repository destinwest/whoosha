# WHOOSHA — Claude Code Project Briefing
> Read this file at the start of every session. Reference specific sections by name when asking for help.

---

## 1. App Concept

**Whoosha** is a web application that helps elementary-aged children (ages 5–12) regulate their nervous systems through interactive, multisensory breathing games. The name evokes the sound and feeling of a calming breath.

Children trace illustrated shapes on the screen with their finger, following a guided breathing pattern. Visual feedback, audio cues, and gentle on-screen encouragement guide the pace. The experience is tactile, calming, and designed to work even when a child is dysregulated or distressed.

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
whoosha.com/home          → Game Selection Home (protected, child-friendly)
whoosha.com/games/square  → Square Breathing Game (protected, immersive)
whoosha.com/dashboard     → Parent Dashboard (protected, parent audience)
whoosha.com/account       → Account Settings (protected, parent audience)
```

### MVP Scope — Build These
- Landing Page (`/`)
- Login Page (`/login`)
- Sign Up Page (`/signup`)
- Game Selection Home (`/home`)
- Square Breathing Game (`/games/square`)

### Post-MVP — Stub Routes Only
- Demo Page (`/demo`) — public interactive preview of Square Breathing, no login required. For MVP, this can be a minimal version of the game page with a banner saying "Sign up to save your progress." Clicking the demo animation on the landing page navigates here.
- Parent Dashboard (`/dashboard`) — stub with placeholder UI
- Account Settings (`/account`) — stub with placeholder UI

---

## 6. Screen-by-Screen Layout Specifications

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
**Background:** Pale mint `#DFF0E6`  
**Feel:** Welcoming, calm, child-appropriate — soothing and rewarding palette dominates

**Layout:**
- **Minimal header:** App logo centered or left. Small parent/account icon top right only. No other navigation visible.
- **Greeting:** Large, warm, rounded text. E.g. "Hi Lily 🌿" using the active child's first name. Pulled from Supabase. Centered below header.
- **Game cards grid:** 2x2 grid on tablet, 2x2 on phone (scrollable if needed), single column on very small screens. Each card:
  - Large rounded rectangle, minimum 180px tall, generous padding
  - Soft background color from soothing palette — one card per color (sage green, teal, lavender, amber)
  - Simple illustrated shape icon centered (square, infinity, hexagon, flower)
  - Game name in large rounded font below icon
  - One short line of description ("Trace the square and breathe")
  - Entire card is tappable — large touch target
- **Bottom of screen:** Only if needed — small parent icon to access dashboard. No other navigation.
- **Inactive games** (not yet built): Show card in muted/desaturated state with small lock icon. Still tappable but shows gentle "coming soon" message rather than navigating.

---

### 6.4 Square Breathing Game Page (`/games/square`)
**Audience:** Child (immersive)  
**Goal:** Child traces the square and completes the breathing exercise  
**Background:** Starts at pale mint `#DFF0E6`, slowly deepens toward sage `#4A9B7F` as exercise progresses  
**Feel:** All interface disappears. Only the game exists.

**Layout:**
- **Exit button only:** Small rounded button, top left, arrow or X icon. Tappable at all times. Returns to `/home`. No label needed.
- **Shape:** Large centered square with thick rounded-corner stroke. Takes up approximately 60-70% of screen width. Soft teal `#5B9FAA` base color. Side labels (Breathe In, Hold, Breathe Out, Hold) in soft muted text along each side.
- **Start circle:** A larger pulsing circle in amber `#D4A056` sits at the bottom-left corner of the square. Pulses gently to invite touch. This is the child's finger target — they place and hold their finger on it to begin.
- **Pacing circle:** A smaller circle in soft white or pale mint, distinct from the start circle. Invisible until the child touches the start circle. Once triggered, travels the perimeter of the square at a constant speed — 4 seconds per side, corners rounded smoothly with no pause. This circle is the guide the child tries to follow.
- **Child's trace circle:** The start circle follows the child's finger position, snapped to the nearest point on the square path. It does not need to stay precisely on the pacing circle — the child simply tries to keep it as close as possible. There is no penalty, no error state, no feedback text for being off pace.
- **Progress trail:** A soft coral/amber trail draws behind the child's trace circle along the path, showing where they have been. Fades gently over time so completed segments don't clutter the view.
- **Phase instruction text:** Large, soft, centered text below the shape showing the current breathing phase — "Breathe in," "Hold," "Breathe out," "Hold." Phase is determined by the pacing circle's current position on the square, not the child's finger. Fades in and out gently on phase change.
- **No pacing feedback text.** The pacing circle is the only guide. Removing text feedback reduces cognitive load and keeps the experience purely tactile and visual.
- **Completion:** Triggered when the pacing circle completes the configured number of cycles (default: 4). Background softens back to pale mint. Gentle radial glow from center of square. Text: "Beautiful work 🌟" with a soft "Go again?" button and an "All done" button that returns to `/home`. No confetti, no loud animation — never re-excite a nervous system you just calmed.
- **Session save:** On completion, write a record to Supabase `sessions` table with `child_id`, `game_slug: 'square-breathing'`, `duration_seconds`, `completed: true`.

**Square Breathing Timing (one full cycle = 16 seconds):**

The square is traced counterclockwise starting at the bottom-left corner. Each side carries its own breathing instruction. Corners are simply turning points — the child continues tracing without pausing. The breathing phase transitions the moment the corner is reached.

```
Side 1 (bottom-left → bottom-right):  Breathe IN   — 4 seconds
Side 2 (bottom-right → top-right):    HOLD         — 4 seconds
Side 3 (top-right → top-left):        Breathe OUT  — 4 seconds
Side 4 (top-left → bottom-left):      HOLD         — 4 seconds
```

One cycle completes and the exercise either loops or ends based on a configurable cycle count (default: 4 cycles for MVP).

**Corner behavior:** No pause at corners. The child's finger rounds the corner naturally and the next phase label fades in immediately as the new side begins. The pacing dot advances smoothly through corners without stopping.

Expected pace per side: user should traverse each side in exactly 4 seconds.
Tolerance: if finger is more than 20% of a segment's length ahead of or behind expected position, show pacing feedback.

**Implementation notes:**
- Use React `useRef` and `requestAnimationFrame` for smooth animation — avoid re-rendering the whole component tree on every frame
- Use an HTML `<canvas>` element with a React ref, drawing the square, pacing circle, trace circle, and trail via Canvas 2D API
- **Pacing circle:** driven entirely by a timer using `performance.now()`. Position is calculated as a function of elapsed time — no user input affects it. It moves at a constant rate of 4 seconds per side, interpolating linearly along each side's start and end coordinates. Corners are passed through smoothly with no pause.
- **Child's trace circle:** driven by `onTouchMove` (mobile) and `onMouseMove` (desktop fallback). On each move event, project the finger's raw canvas coordinates onto the nearest point on the current square path using a simple point-to-segment projection. The trace circle renders at that projected point.
- **Phase determination:** derived from the pacing circle's current progress through the cycle, not the child's finger position. Calculate which side the pacing circle is on and display the corresponding breathing instruction.
- **Game start trigger:** the pacing circle does not begin moving until the child places their finger within a threshold radius (approx 40px) of the start circle. Once triggered, the timer starts and does not stop until the configured cycles are complete or the child exits.
- **Trail rendering:** draw a series of small circles or a path stroke along the child's historical positions on the square. Fade older trail segments using decreasing alpha over approximately 2 seconds so the trail feels alive without cluttering the canvas.
- **Canvas sizing:** the square should resize responsively based on viewport. Recalculate all path coordinates on window resize using a `ResizeObserver`.

---

### 6.5 Onboarding Screen (`/onboarding`)
**Audience:** Parent (first login only)
**Goal:** Capture child's first name before entering the app
**Background:** Pale mint `#DFF0E6`
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
#F1E3C6  Warm Cream      → Landing page, marketing sections
#EDE8DF  Rose Neutral    → Parent dashboard, account pages
#DFF0E6  Pale Mint       → Login/signup, game home, game pages
```

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
#D4A056  Warm Amber      → Encouragement feedback, celebration moments, completion states
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
- Pure white `#FFFFFF` as a background — use cream or mint instead
- Pure black `#000000` as text — use `#3E5E52` forest green instead
- Saturated bright reds, oranges, or yellows as dominant colors
- High-contrast harsh color combinations on child-facing screens

### Color-as-Feedback in Games
Background color during breathing games should animate subtly through the exercise:
- Start: Pale Mint `#DFF0E6`
- Mid-exercise: Soft Teal `#5B9FAA` at low opacity
- Completion: Returns to Pale Mint `#DFF0E6`
This mirrors the physiological shift from alertness to calm and is evidence-based.

---

## 8. Landing Page Demo Animation Spec

The auto-playing Square Breathing demo on the landing page is a looping CSS or React animation — not interactive, not clickable (unless parent clicks it, which navigates to `/demo`).

**Animation behavior:**
- A square shape identical to the game version renders centered in the right column of the hero
- A glowing amber dot traces the perimeter of the square continuously, **counterclockwise starting from the bottom-left** — matching the actual game direction
- The trace trail fills in behind the dot in coral/amber, then fades out as the dot completes a full loop and begins again
- Phase label text appears alongside the relevant side: "Breathe in" bottom side, "Hold" right side, "Breathe out" top side, "Hold" left side — each fading in when the dot reaches that segment
- Loop duration: approximately 16 seconds (4 sides × 4 seconds), then seamlessly restarts
- Subtle pulsing glow effect on the dot
- No sound in the demo — audio is a game-only feature

**Implementation:** Use CSS keyframe animations or Framer Motion for the dot path and trail. The square itself is an SVG with a `stroke-dashoffset` animation for the trail effect.

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
│   └── palette-greens.png
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
    │           ├── SquareGame.jsx         # Main game component
    │           ├── SquareCanvas.jsx       # Canvas drawing logic
    │           ├── PaceTracker.jsx        # Timing and feedback logic
    │           └── CompletionScreen.jsx   # End of game screen
    └── pages/
        ├── LandingPage.jsx
        ├── LoginPage.jsx
        ├── SignupPage.jsx
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
        'bg-cream':     '#F1E3C6',
        'bg-rose':      '#EDE8DF',
        'bg-mint':      '#DFF0E6',
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
- [ ] Landing page with auto-playing square breathing demo animation
- [ ] Login page with email/password + Google OAuth (Supabase Auth)
- [ ] Sign up page with email/password + Google OAuth
- [ ] Protected routing (redirect to login if not authenticated)
- [ ] Game selection home page showing all four game cards (three locked/coming soon)
- [ ] Square Breathing game — full tracing mechanic, pacing feedback, completion screen
- [ ] Session save to Supabase on game completion
- [ ] Greeting with child's first name on home screen
- [ ] Child profile creation flow (triggered after first login if no children exist)
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

## 16. Open Questions

- what the logo looks like 
- whether you want sound in the MVP
- what the app tagline is
- whether the landing page needs real copy or placeholder copy for now

### Sample In-App Copy
- Game instruction: "Breathe in slowly as you trace this side..."
- Pacing — too fast: "Slow down a little 🌿"
- Pacing — too slow: "Keep moving, nice and steady 🌊"
- Pacing — on pace: "You're doing beautifully ✨"
- Completion: "Beautiful work 🌟 Your body is feeling calmer now."
- Home greeting: "Hi Lily 🌿 Which game would you like to play?"
- Error message: "Something went a little sideways. Let's try again."

---

*Last updated: Whoosha MVP Planning Session*
*Prepared for use with Claude Code*
