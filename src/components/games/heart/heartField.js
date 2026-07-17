// ── heartField.js ─────────────────────────────────────────────────────────────
// Baked background for the Heart game: the well-tuned salmon-radial field, now
// with a soft, out-of-focus "drifting heart field" floating through the warmth.
// Replaced the plain salmon radial that lived inline in HeartGame.jsx
// (2026-07-17). Star keeps _shared/nightSky.js; Infinity has its own
// lakeSurface.js; this module is the Heart game's own background.
//
// Composition:
//   • BASE — the original salmon radial: red-leaning coral, brightest at the
//     canvas center, deepening toward the edges. Unchanged palette so it still
//     matches the card gradient in games.js.
//   • WARMTH BLOOM — a gentle screen-blended glow biased upper-center, so the
//     whole field breathes toward the traced heart without flattening the base.
//   • HEART FIELD — soft, glowing hearts drifting through the warmth. Each heart
//     is a radial gradient (bright core → transparent edge) CLIPPED to a heart
//     silhouette, so its edges feather into bokeh — the same soft-radial-glow
//     technique the lake ripples and Milky Way band use, just shaped by a heart
//     clip (no ctx.filter — softness is all gradient falloff). Two depth
//     classes: large, dim, multiply-blended hearts far back for depth; smaller,
//     lighter screen-blended motes floating near. Seeded scatter, biased toward
//     the edges so the center stays clear for the game's heart track.
//
// Baked into one offscreen canvas at device resolution, once per resize.
// Per-frame cost at runtime: zero (drawn as a bitmap). Follows the iOS rules:
// bake at resize, composite as bitmap, no per-frame filters.

import { mulberry32 } from '../_shared/nightSky'

// ── Base salmon radial ──────────────────────────────────────────────────────
// Carried over verbatim from HeartGame.jsx's buildSalmonBg. Stops authored as
// HSL (hue ~6–12°, red-leaning coral/salmon — orange starts around 25–35°) so
// the paletteColor() scaling lever stays available for future tuning.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function paletteColor(h, s, l, pal, alpha) {
  const ss = clamp(s * pal.satMul, 0, 100)
  const ll = clamp(l + pal.lightShift, 0, 100)
  return alpha === undefined
    ? `hsl(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%,${alpha})`
}

const SALMON_STOPS = [
  { t: 0.00, h: 8,  s: 68.0, l: 72.0 },
  { t: 0.35, h: 9,  s: 58.0, l: 66.0 },
  { t: 0.65, h: 10, s: 48.0, l: 58.0 },
  { t: 1.00, h: 12, s: 40.0, l: 48.0 },
]
const SALMON_PALETTE = { satMul: 1.0, lightShift: 0.0 }

// ── Warmth bloom (upper-center) ─────────────────────────────────────────────
const BLOOM_CX_RATIO = 0.5
const BLOOM_CY_RATIO = 0.40
const BLOOM_R_RATIO  = 0.60                 // × max(w, h)
const BLOOM_INNER    = 'rgba(255,224,206,0.30)'   // warm cream-coral
const BLOOM_MID      = 'rgba(255,210,190,0.12)'

// ── Heart field ─────────────────────────────────────────────────────────────
// Fixed seed → the field is pixel-identical across re-bakes (resize).
const FIELD_SEED = 0x0EA27

// Two depth classes. FAR hearts sit behind, multiply-blended so they read as
// soft debossed shadow-hearts giving the field depth; NEAR hearts float in
// front, screen-blended so they read as gentle luminous motes.
const FAR_COUNT       = 11
const FAR_BLEND       = 'multiply'
const FAR_RGB         = '150,58,70'      // deep warm rose — reads as shadow on salmon
const FAR_ALPHA_MIN   = 0.05
const FAR_ALPHA_MAX   = 0.10
const FAR_SIZE_MIN    = 0.16             // heart half-height as a fraction of min(w,h)
const FAR_SIZE_MAX    = 0.30

const NEAR_COUNT      = 15
const NEAR_BLEND      = 'screen'
const NEAR_RGB        = '255,231,214'    // warm cream — reads as light on salmon
const NEAR_ALPHA_MIN  = 0.06
const NEAR_ALPHA_MAX  = 0.13
const NEAR_SIZE_MIN   = 0.05
const NEAR_SIZE_MAX   = 0.13

// Hearts are scattered on a ring band around center — never dead-center (the
// track lives there) and never jammed into the extreme corners.
const RING_MIN = 0.30   // × the half-diagonal
const RING_MAX = 0.98
const TILT_MAX = 0.5    // ± radians of playful tilt

// ── Unit heart path ───────────────────────────────────────────────────────
// A classic heart traced as 6 mirrored cubic Beziers, normalized to half-
// height 1 and centered at (0,0) — the same proportions as the game track's
// HEART_UNIT_SEGS (HeartCanvas.jsx), divided by its 38px half-height. Traced
// into the current path at unit scale; the caller sets up translate/rotate/
// scale and clips to it before filling the glow gradient.
const H = 38
const UNIT_HEART = [
  [0/H, -30/H,  -2/H, -35/H,  -6/H, -38/H, -12/H, -38/H],
  [-12/H, -38/H,  -24/H, -38/H,  -36/H, -30/H, -36/H, -14/H],
  [-36/H, -14/H,  -36/H,  12/H,   0/H,  38/H,   0/H,  38/H],
  [0/H,  38/H,    0/H,  38/H,   36/H,  12/H,  36/H, -14/H],
  [36/H, -14/H,   36/H, -30/H,  24/H, -38/H,  12/H, -38/H],
  [12/H, -38/H,    6/H, -38/H,   2/H, -35/H,   0/H, -30/H],
]

function traceUnitHeart(ctx) {
  ctx.moveTo(UNIT_HEART[0][0], UNIT_HEART[0][1])
  for (const [, , c1x, c1y, c2x, c2y, px, py] of UNIT_HEART) {
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, px, py)
  }
  ctx.closePath()
}

// Draws one soft glow-heart: clips to the heart silhouette at (cx,cy), then
// fills a radial gradient that is brightest at the heart's core and fades to
// transparent past its edge — so the silhouette's own edges feather into
// bokeh. size = heart half-height in px; rgb/alpha/tilt per depth class.
function drawGlowHeart(ctx, cx, cy, size, tilt, rgb, alpha) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(size, size)                 // unit heart → px

  ctx.beginPath()
  traceUnitHeart(ctx)
  ctx.clip()

  // Gradient reaches a little past the unit heart (radius ~1.25) so the core
  // glow sits inside the silhouette and the falloff kisses its edges.
  const g = ctx.createRadialGradient(0, 0.05, 0, 0, 0.05, 1.25)
  g.addColorStop(0.0, `rgba(${rgb},${alpha.toFixed(3)})`)
  g.addColorStop(0.6, `rgba(${rgb},${(alpha * 0.55).toFixed(3)})`)
  g.addColorStop(1.0, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(-1.3, -1.3, 2.6, 2.6)

  ctx.restore()
}

// Scatters `count` hearts of one depth class onto the ring band around center.
function scatterHearts(ctx, rand, w, h, count, blend, rgb, aMin, aMax, sMin, sMax) {
  const cx = w / 2
  const cy = h / 2
  const halfDiag = Math.hypot(w, h) / 2
  const minSide  = Math.min(w, h)

  ctx.globalCompositeOperation = blend
  for (let i = 0; i < count; i++) {
    // Ring-band placement: even angular spread + jitter, radius biased outward.
    const ang = (i / count) * Math.PI * 2 + (rand() - 0.5) * 1.2
    const rr  = RING_MIN + (RING_MAX - RING_MIN) * Math.sqrt(rand())  // sqrt → outward bias
    const px  = cx + Math.cos(ang) * rr * halfDiag
    const py  = cy + Math.sin(ang) * rr * halfDiag

    const size  = (sMin + rand() * (sMax - sMin)) * minSide
    const tilt  = (rand() - 0.5) * 2 * TILT_MAX
    const alpha = aMin + rand() * (aMax - aMin)

    drawGlowHeart(ctx, px, py, size, tilt, rgb, alpha)
  }
}

// ── buildHeartFieldBg ─────────────────────────────────────────────────────
export function buildHeartFieldBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base salmon radial — center → edge.
  const cx = w / 2
  const cy = h / 2
  const outerR = Math.hypot(w, h) / 2
  const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR)
  for (const s of SALMON_STOPS) base.addColorStop(s.t, paletteColor(s.h, s.s, s.l, SALMON_PALETTE))
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Heart field — far (behind) then near (in front).
  const rand = mulberry32(FIELD_SEED)
  scatterHearts(ctx, rand, w, h, FAR_COUNT,  FAR_BLEND,  FAR_RGB,
    FAR_ALPHA_MIN,  FAR_ALPHA_MAX,  FAR_SIZE_MIN,  FAR_SIZE_MAX)
  scatterHearts(ctx, rand, w, h, NEAR_COUNT, NEAR_BLEND, NEAR_RGB,
    NEAR_ALPHA_MIN, NEAR_ALPHA_MAX, NEAR_SIZE_MIN, NEAR_SIZE_MAX)

  // Warmth bloom — screen-blended, biased upper-center, drawn last so it lifts
  // both the base and the hearts toward the traced heart.
  ctx.globalCompositeOperation = 'screen'
  const bx = w * BLOOM_CX_RATIO
  const by = h * BLOOM_CY_RATIO
  const br = Math.max(w, h) * BLOOM_R_RATIO
  const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, br)
  bloom.addColorStop(0.0, BLOOM_INNER)
  bloom.addColorStop(0.5, BLOOM_MID)
  bloom.addColorStop(1.0, 'rgba(255,210,190,0)')
  ctx.fillStyle = bloom
  ctx.fillRect(0, 0, w, h)

  ctx.globalCompositeOperation = 'source-over'
  return oc
}
