// ── lakeSurface.js ────────────────────────────────────────────────────────────
// Baked background for the Infinity game: an abstract Rocky Mountain lake
// surface, seen from its edge (replaced the shared night sky, 2026-07-14 —
// Star keeps _shared/nightSky.js; this module is Infinity's own).
//
// Composition (per the user's design session, from their two reference photos):
//   • WATER ONLY — no shore pebbles, no treeline, no sky. The whole screen is
//     lake surface.
//   • Bottom = muted gray-brown shallows (the lake edge underfoot), rising
//     through dusty steel blue into a deep royal blue built around #0656AB
//     (user's anchor — the first aquamarine version read too close to Square).
//   • Peak vibrancy sits UPPER-CENTER (behind the figure-8's heart) as a soft
//     radial glow, easing slightly toward the top edge.
//   • BROAD, SOFT horizontal ripple bands of light and shadow — the natural-
//     light ripples of the second reference photo, abstracted. Static.
//   • Mood: soft morning calm — vivid at the center, quiet everywhere else.
//
// Baked into one offscreen canvas at device resolution, once per resize.
// Per-frame cost at runtime: zero (drawn as a bitmap). Follows the iOS rules:
// bake at resize, composite as bitmap, no per-frame filters.

import { mulberry32 } from '../_shared/nightSky'

// Vertical water gradient, bottom → top. Muted shore shallows into deep royal
// blue — the whole palette is built around #0656AB (user's anchor, 2026-07-14;
// the first aquamarine version read too close to the Square game's teal).
// Stops are authored bottom-first for readability, then flipped for the
// canvas gradient (which runs top → bottom).
const WATER_STOPS_BOTTOM_UP = [
  [0.00, '#7C7264'],   // muted gray-brown — the shallows at the viewer's feet
  [0.10, '#6E7278'],   // brown giving way to gray-slate
  [0.24, '#3A6392'],   // dusty steel blue — first real water color
  [0.46, '#1B63B4'],   // royal blue rising
  [0.70, '#0656AB'],   // THE anchor — deep royal blue
  [1.00, '#2E77CC'],   // lighter, luminous royal at the top edge
]

// Upper-center vibrancy glow — where the figure-8's heart sits. Screen-blended
// so it brightens the base wash without flattening it.
const GLOW_CX_RATIO = 0.5
const GLOW_CY_RATIO = 0.34
const GLOW_R_RATIO  = 0.62               // × max(w, h)
const GLOW_COLOR    = 'rgba(72,148,240,0.32)'
const GLOW_MID      = 'rgba(72,148,240,0.13)'

// Morning haze — a whisper of pale light across the upper water.
const HAZE_COLOR = 'rgba(224,238,252,0.07)'

// ── Ripple bands ──────────────────────────────────────────────────────────────
// Each band is a row of wide, heavily y-squashed radial glows (the same
// overlapping-soft-glow technique as the night sky's Milky Way band, rotated
// horizontal), jittered by a seeded PRNG so every band undulates a little
// differently — but identically across re-bakes. Light bands screen-blend
// (sun catching a swell); shadow bands multiply (the trough beside it).
//
// Deliberately ABSTRACT, not physical (user's design call, 2026-07-21): few,
// large, soft swells rather than many fine lines. Spacing is foreshortened the
// way the user wants it read — bands sit CLOSEST TOGETHER at the bottom
// (foreground water underfoot) and SPREAD APART as they climb toward the top
// (the surface receding into the distance). RIPPLE_SPREAD_POWER < 1 does this:
// even band indices map through pow(t) so the gaps shrink toward the bottom.
// Bands also grow a touch larger toward the foreground (RIPPLE_DEPTH_SCALE_*).
const RIPPLE_SEED       = 0x1A4E5    // fixed — bands identical across re-bakes
const RIPPLE_BANDS      = 5          // few — abstract, not a fine ripple texture
const RIPPLE_Y_MIN      = 0.30       // topmost (most distant) band...
const RIPPLE_Y_MAX      = 0.97       // ...down to just above the bottom edge
const RIPPLE_SPREAD_POWER = 0.5      // <1 → bands bunch toward the bottom/foreground
const RIPPLE_DEPTH_SCALE_TOP    = 0.85   // size multiplier for the most distant band
const RIPPLE_DEPTH_SCALE_BOTTOM = 1.15   // ...and the nearest foreground band
const RIPPLE_GLOWS_MIN  = 4          // glows per band (jittered) — fewer + larger = softer
const RIPPLE_GLOWS_MAX  = 6
const RIPPLE_RAD_MIN    = 0.30       // glow radius before squashing, × w — large, broad swells
const RIPPLE_RAD_MAX    = 0.55
const RIPPLE_SQUASH_MIN = 0.050      // ellipse squash — smaller = flatter band
const RIPPLE_SQUASH_MAX = 0.100
const RIPPLE_WAVE_AMP   = 0.012      // per-glow y jitter, × h — the undulation
const RIPPLE_ROW_JITTER = 0.03       // band-row scatter, × h (small, so spacing holds)
const LIGHT_ALPHA_MIN   = 0.040      // softer than before — quiet, low-contrast light
const LIGHT_ALPHA_MAX   = 0.075
const SHADOW_ALPHA_MIN  = 0.035
const SHADOW_ALPHA_MAX  = 0.065
const LIGHT_RGB         = '224,238,252'  // pale sunlit blue-white
const SHADOW_RGB        = '8,40,78'      // deep lake navy

// ── buildLakeSurfaceBg ────────────────────────────────────────────────────────
export function buildLakeSurfaceBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base water wash — bottom-up stops flipped into a top-down gradient.
  const base = ctx.createLinearGradient(0, h, 0, 0)
  for (const [stop, color] of WATER_STOPS_BOTTOM_UP) base.addColorStop(stop, color)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Upper-center vibrancy glow (screen — brightens, never muddies).
  ctx.globalCompositeOperation = 'screen'
  const gx = w * GLOW_CX_RATIO
  const gy = h * GLOW_CY_RATIO
  const gr = Math.max(w, h) * GLOW_R_RATIO
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
  glow.addColorStop(0,   GLOW_COLOR)
  glow.addColorStop(0.5, GLOW_MID)
  glow.addColorStop(1,   'rgba(72,148,240,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Morning haze across the upper water.
  const haze = ctx.createLinearGradient(0, 0, 0, h * 0.5)
  haze.addColorStop(0, HAZE_COLOR)
  haze.addColorStop(1, 'rgba(224,238,252,0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, w, h * 0.5)

  // Ripple bands — alternating light/shadow, distributed down the water with
  // a little seeded scatter so the spacing never reads as mechanical.
  const rand = mulberry32(RIPPLE_SEED)
  for (let b = 0; b < RIPPLE_BANDS; b++) {
    const isLight = b % 2 === 0
    // Foreshortened row position: pow(t) < 1 packs bands toward the bottom
    // (foreground) and spreads them apart toward the top (receding distance).
    const t      = RIPPLE_BANDS === 1 ? 0.5 : b / (RIPPLE_BANDS - 1)
    const fDepth = Math.pow(t, RIPPLE_SPREAD_POWER)   // 0 = distant top, 1 = near bottom
    const y  = h * (RIPPLE_Y_MIN + (RIPPLE_Y_MAX - RIPPLE_Y_MIN) * fDepth
                    + (rand() - 0.5) * RIPPLE_ROW_JITTER)
    // Nearer (foreground) bands read a touch larger than distant ones.
    const depthScale = RIPPLE_DEPTH_SCALE_TOP
      + (RIPPLE_DEPTH_SCALE_BOTTOM - RIPPLE_DEPTH_SCALE_TOP) * fDepth
    const squash = RIPPLE_SQUASH_MIN + rand() * (RIPPLE_SQUASH_MAX - RIPPLE_SQUASH_MIN)
    const alpha  = isLight
      ? LIGHT_ALPHA_MIN  + rand() * (LIGHT_ALPHA_MAX - LIGHT_ALPHA_MIN)
      : SHADOW_ALPHA_MIN + rand() * (SHADOW_ALPHA_MAX - SHADOW_ALPHA_MIN)
    const rgb    = isLight ? LIGHT_RGB : SHADOW_RGB
    const glows  = RIPPLE_GLOWS_MIN + Math.floor(rand() * (RIPPLE_GLOWS_MAX - RIPPLE_GLOWS_MIN + 1))
    const rad    = w * (RIPPLE_RAD_MIN + rand() * (RIPPLE_RAD_MAX - RIPPLE_RAD_MIN)) * depthScale

    ctx.globalCompositeOperation = isLight ? 'screen' : 'multiply'
    for (let g = 0; g < glows; g++) {
      // Glow centers drift across the width with overlap; each rides a hair
      // above/below the band's row so the band undulates like a real swell.
      const cx = w * ((g + rand() * 0.8 - 0.4) / (glows - 1))
      const cy = y + (rand() - 0.5) * 2 * RIPPLE_WAVE_AMP * h
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, squash)
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad)
      rg.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`)
      rg.addColorStop(1, `rgba(${rgb},0)`)
      ctx.fillStyle = rg
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2)
      ctx.restore()
    }
  }

  ctx.globalCompositeOperation = 'source-over'
  return oc
}
