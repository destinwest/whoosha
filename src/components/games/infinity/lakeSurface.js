// ── lakeSurface.js ────────────────────────────────────────────────────────────
// Baked background for the Infinity game: an abstract Rocky Mountain lake
// surface, seen from its edge (replaced the shared night sky, 2026-07-14 —
// Star keeps _shared/nightSky.js; this module is Infinity's own).
//
// Composition (per the user's design session, from their two reference photos):
//   • WATER ONLY — no shore pebbles, no treeline, no sky. The whole screen is
//     lake surface.
//   • Bottom = muted gray-brown shallows (the lake edge underfoot), rising
//     through murky green into a vibrant alpine aquamarine.
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

// Vertical water gradient, bottom → top. Muted shore shallows into aquamarine.
// Stops are authored bottom-first for readability, then flipped for the
// canvas gradient (which runs top → bottom).
const WATER_STOPS_BOTTOM_UP = [
  [0.00, '#7C7264'],   // muted gray-brown — the shallows at the viewer's feet
  [0.10, '#6E7767'],   // brown giving way to olive
  [0.24, '#4A8A79'],   // murky green — first real water color
  [0.46, '#2CAD9A'],   // teal-green
  [0.70, '#33C7B2'],   // aquamarine
  [1.00, '#4ED2C1'],   // soft vivid aqua at the top edge
]

// Upper-center vibrancy glow — where the figure-8's heart sits. Screen-blended
// so it brightens the base wash without flattening it.
const GLOW_CX_RATIO = 0.5
const GLOW_CY_RATIO = 0.34
const GLOW_R_RATIO  = 0.62               // × max(w, h)
const GLOW_COLOR    = 'rgba(96,232,210,0.30)'
const GLOW_MID      = 'rgba(96,232,210,0.12)'

// Morning haze — a whisper of pale light across the upper water.
const HAZE_COLOR = 'rgba(226,250,244,0.07)'

// ── Ripple bands ──────────────────────────────────────────────────────────────
// Each band is a row of wide, heavily y-squashed radial glows (the same
// overlapping-soft-glow technique as the night sky's Milky Way band, rotated
// horizontal), jittered by a seeded PRNG so every band undulates a little
// differently — but identically across re-bakes. Light bands screen-blend
// (sun catching a swell); shadow bands multiply (the trough beside it).
const RIPPLE_SEED       = 0x1A4E5    // fixed — bands identical across re-bakes
const RIPPLE_BANDS      = 9
const RIPPLE_Y_MIN      = 0.30       // bands live in the middle/lower water...
const RIPPLE_Y_MAX      = 0.97       // ...down to just above the bottom edge
const RIPPLE_GLOWS_MIN  = 5          // glows per band (jittered)
const RIPPLE_GLOWS_MAX  = 8
const RIPPLE_SQUASH_MIN = 0.045      // ellipse squash — smaller = flatter band
const RIPPLE_SQUASH_MAX = 0.085
const RIPPLE_WAVE_AMP   = 0.012      // per-glow y jitter, × h — the undulation
const LIGHT_ALPHA_MIN   = 0.05
const LIGHT_ALPHA_MAX   = 0.10
const SHADOW_ALPHA_MIN  = 0.05
const SHADOW_ALPHA_MAX  = 0.09
const LIGHT_RGB         = '228,250,244'  // pale sunlit aqua-white
const SHADOW_RGB        = '10,72,66'     // deep lake teal

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
  glow.addColorStop(1,   'rgba(96,232,210,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Morning haze across the upper water.
  const haze = ctx.createLinearGradient(0, 0, 0, h * 0.5)
  haze.addColorStop(0, HAZE_COLOR)
  haze.addColorStop(1, 'rgba(226,250,244,0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, w, h * 0.5)

  // Ripple bands — alternating light/shadow, distributed down the water with
  // a little seeded scatter so the spacing never reads as mechanical.
  const rand = mulberry32(RIPPLE_SEED)
  for (let b = 0; b < RIPPLE_BANDS; b++) {
    const isLight = b % 2 === 0
    // Base row position: even spread across the ripple zone + jitter.
    const t  = RIPPLE_BANDS === 1 ? 0.5 : b / (RIPPLE_BANDS - 1)
    const y  = h * (RIPPLE_Y_MIN + (RIPPLE_Y_MAX - RIPPLE_Y_MIN) * t
                    + (rand() - 0.5) * 0.05)
    const squash = RIPPLE_SQUASH_MIN + rand() * (RIPPLE_SQUASH_MAX - RIPPLE_SQUASH_MIN)
    const alpha  = isLight
      ? LIGHT_ALPHA_MIN  + rand() * (LIGHT_ALPHA_MAX - LIGHT_ALPHA_MIN)
      : SHADOW_ALPHA_MIN + rand() * (SHADOW_ALPHA_MAX - SHADOW_ALPHA_MIN)
    const rgb    = isLight ? LIGHT_RGB : SHADOW_RGB
    const glows  = RIPPLE_GLOWS_MIN + Math.floor(rand() * (RIPPLE_GLOWS_MAX - RIPPLE_GLOWS_MIN + 1))
    const rad    = w * (0.16 + rand() * 0.14)   // glow radius before squashing

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
