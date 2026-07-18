// ── heartField.js ─────────────────────────────────────────────────────────────
// Baked background for the Heart game: "Held in Warm Light."
//
// Design brief (2026-07-17 experiment): make a young child feel LOVED, CALM, and
// JOYFUL. Unlike Square (light shafts on a meadow), Hexagon (red rock canyon),
// and Triangle (misty mountains), the Heart background is NOT an abstraction of a
// real landscape and is NOT literal hearts — it's an emotional abstraction of
// *being held*, rendered purely in warm light. It replaces the earlier
// drifting-heart field, which drew the game's own shape and read as too literal
// and busy against the "quiet, abstract" precedent of the other games.
//
// Composition (drawn back → front, all baked into one offscreen canvas):
//   • ENVELOPING WARMTH — a radial vignette that glows tender gold at the heart
//     of the screen and deepens to a plush rose toward the edges. Bright-center /
//     deep-edge is the felt sense of being cupped in warm hands: it draws the eye
//     inward (calm) and leaves the center clear for the traced heart track.
//   • CRADLE OF LIGHT — two soft luminous sweeps rising from the lower corners
//     and curving up the sides, like being gently held and lifted from below.
//     Safety (held) plus a buoyant upward lift (joy), never literal arms.
//   • TENDER CORE BLOOM — a warm cream-gold glow biased to where the heart track
//     lives: the "loved" focal warmth that lifts the whole field.
//   • JOY MOTES — soft, out-of-focus warm bokeh drifting through the periphery
//     (dust caught in a sunbeam — NOT hearts). Two depth classes: a few dim,
//     soft-light motes far back for depth; brighter, screen-blended motes of
//     cream and rose-gold floating near. Seeded scatter, biased outward (center
//     stays clear for the track) and slightly upward (the feeling lifts).
//   • GRAIN — a whisper of baked noise so the large rose gradient doesn't band on
//     iOS. Overlay-blended, tiny alpha; adds texture, never visible as "noise."
//
// Baked into one offscreen canvas at device resolution, once per resize.
// Per-frame cost at runtime: zero (drawn as a bitmap). Follows the iOS rules:
// bake at resize, composite as bitmap, no per-frame filters.

import { mulberry32 } from '../_shared/nightSky'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ── Enveloping warmth (base radial) ─────────────────────────────────────────
// Authored as HSL so the paletteColor() scaling levers stay available for future
// tuning. Runs gold → apricot → coral-rose → deep rose: sunrise-in-the-heart.
// Center biased slightly above the geometric middle so the warmth sits where the
// traced heart's lobes are, not below them.
function paletteColor(h, s, l, pal, alpha) {
  const ss = clamp(s * pal.satMul, 0, 100)
  const ll = clamp(l + pal.lightShift, 0, 100)
  return alpha === undefined
    ? `hsl(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%,${alpha})`
}

const WARMTH_STOPS = [
  { t: 0.00, h: 32,  s: 88.0, l: 84.0 },   // peach-gold cream core
  { t: 0.22, h: 14,  s: 80.0, l: 74.0 },   // warm apricot-coral
  { t: 0.48, h: 4,   s: 72.0, l: 66.0 },   // coral-rose
  { t: 0.74, h: 352, s: 60.0, l: 56.0 },   // rose
  { t: 1.00, h: 344, s: 48.0, l: 42.0 },   // plush deep rose (the "cupped" edge)
]
const WARMTH_PALETTE = { satMul: 1.0, lightShift: 0.0 }
const WARMTH_CX_RATIO = 0.50
const WARMTH_CY_RATIO = 0.46
const WARMTH_R_MUL    = 1.02   // × half-diagonal

// ── Cradle of light (two lower-corner sweeps) ───────────────────────────────
// Large soft radial glows centered just outside the lower-left and lower-right,
// so only their rising inner edge shows — light curving up the sides from below.
// Screen-blended warm cream-rose; low alpha so it reads as ambient structure.
const CRADLE_RGB       = '255,222,200'
const CRADLE_ALPHA     = 0.17
const CRADLE_R_MUL     = 0.82   // × max(w, h)
const CRADLE_CX_OUT    = 0.06   // horizontal inset of each glow center (× w)
const CRADLE_CY_RATIO  = 0.98   // vertical center (× h) — low, near the bottom

// ── Tender core bloom (upper-center) ────────────────────────────────────────
const BLOOM_CX_RATIO = 0.50
const BLOOM_CY_RATIO = 0.40
const BLOOM_R_RATIO  = 0.55                       // × max(w, h)
const BLOOM_INNER    = 'rgba(255,236,214,0.30)'   // warm cream-gold
const BLOOM_MID      = 'rgba(255,220,196,0.12)'

// ── Joy motes ───────────────────────────────────────────────────────────────
// Soft round bokeh, NOT hearts. Fixed seed → pixel-identical across re-bakes.
const FIELD_SEED = 0x10BE  // "love"

// FAR: a few large, dim, soft-light motes far back for gentle warm depth.
const FAR_COUNT      = 9
const FAR_BLEND      = 'soft-light'
const FAR_RGB        = '255,190,150'
const FAR_ALPHA_MIN  = 0.10
const FAR_ALPHA_MAX  = 0.20
const FAR_SIZE_MIN   = 0.12    // mote radius as a fraction of min(w,h)
const FAR_SIZE_MAX   = 0.24

// NEAR: more, brighter, screen-blended motes floating in front — sparks of joy.
// Two warm tints alternate: cream and rose-gold.
const NEAR_COUNT     = 16
const NEAR_BLEND     = 'screen'
const NEAR_RGB_A     = '255,240,222'   // warm cream
const NEAR_RGB_B     = '255,212,182'   // rose-gold
const NEAR_ALPHA_MIN = 0.06
const NEAR_ALPHA_MAX = 0.14
const NEAR_SIZE_MIN  = 0.03
const NEAR_SIZE_MAX  = 0.09

// Motes sit on a ring band around center — never dead-center (the track lives
// there) and never jammed into the extreme corners.
const RING_MIN     = 0.34   // × the half-diagonal
const RING_MAX     = 1.02
const LIFT_RATIO   = 0.05   // near motes drift up by this fraction of h (buoyancy)

// ── Grain (anti-banding) ────────────────────────────────────────────────────
const GRAIN_TILE  = 128    // px; small noise tile, pattern-tiled across the field
const GRAIN_ALPHA = 0.035  // overlay-blended; adds dither, never visible as noise

// Draws one soft round glow-mote: a radial gradient brightest at its core, fading
// to transparent past its edge, so it reads as out-of-focus bokeh. size = radius
// in px; rgb/alpha per depth class.
function drawGlowMote(ctx, cx, cy, size, rgb, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size)
  g.addColorStop(0.0, `rgba(${rgb},${alpha.toFixed(3)})`)
  g.addColorStop(0.5, `rgba(${rgb},${(alpha * 0.5).toFixed(3)})`)
  g.addColorStop(1.0, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2)
}

// Scatters `count` motes of one depth class onto the ring band around center.
// `lift` pulls placement upward (near class only) for a buoyant feel.
function scatterMotes(ctx, rand, w, h, count, blend, rgbFn, aMin, aMax, sMin, sMax, lift) {
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
    const py  = cy + Math.sin(ang) * rr * halfDiag - lift

    const size  = (sMin + rand() * (sMax - sMin)) * minSide
    const alpha = aMin + rand() * (aMax - aMin)

    drawGlowMote(ctx, px, py, size, rgbFn(i, rand), alpha)
  }
  ctx.globalCompositeOperation = 'source-over'
}

// Builds a small tileable grayscale-noise pattern once, for anti-banding dither.
function buildGrainPattern(ctx, rand) {
  const tile = document.createElement('canvas')
  tile.width = tile.height = GRAIN_TILE
  const tctx = tile.getContext('2d')
  const img = tctx.createImageData(GRAIN_TILE, GRAIN_TILE)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (rand() * 255) | 0
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  tctx.putImageData(img, 0, 0)
  return ctx.createPattern(tile, 'repeat')
}

// ── buildHeartFieldBg ─────────────────────────────────────────────────────
export function buildHeartFieldBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const rand = mulberry32(FIELD_SEED)

  // 1 ─ Enveloping warmth: tender-gold core → plush-rose edge.
  const wx = w * WARMTH_CX_RATIO
  const wy = h * WARMTH_CY_RATIO
  const wr = (Math.hypot(w, h) / 2) * WARMTH_R_MUL
  const warmth = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr)
  for (const s of WARMTH_STOPS) warmth.addColorStop(s.t, paletteColor(s.h, s.s, s.l, WARMTH_PALETTE))
  ctx.fillStyle = warmth
  ctx.fillRect(0, 0, w, h)

  // 2 ─ Cradle of light: soft sweeps rising from the lower corners.
  ctx.globalCompositeOperation = 'screen'
  const cradleR = Math.max(w, h) * CRADLE_R_MUL
  const cradleY = h * CRADLE_CY_RATIO
  for (const cxRatio of [CRADLE_CX_OUT, 1 - CRADLE_CX_OUT]) {
    const gx = w * cxRatio
    const g = ctx.createRadialGradient(gx, cradleY, 0, gx, cradleY, cradleR)
    g.addColorStop(0.0, `rgba(${CRADLE_RGB},${CRADLE_ALPHA})`)
    g.addColorStop(0.55, `rgba(${CRADLE_RGB},${(CRADLE_ALPHA * 0.4).toFixed(3)})`)
    g.addColorStop(1.0, `rgba(${CRADLE_RGB},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalCompositeOperation = 'source-over'

  // 3 ─ Joy motes: far (behind) then near (in front). Alternating tints for near.
  scatterMotes(ctx, rand, w, h, FAR_COUNT, FAR_BLEND,
    () => FAR_RGB, FAR_ALPHA_MIN, FAR_ALPHA_MAX, FAR_SIZE_MIN, FAR_SIZE_MAX, 0)
  scatterMotes(ctx, rand, w, h, NEAR_COUNT, NEAR_BLEND,
    (i) => (i % 2 === 0 ? NEAR_RGB_A : NEAR_RGB_B),
    NEAR_ALPHA_MIN, NEAR_ALPHA_MAX, NEAR_SIZE_MIN, NEAR_SIZE_MAX, h * LIFT_RATIO)

  // 4 ─ Tender core bloom: warm cream-gold lift where the heart track lives.
  ctx.globalCompositeOperation = 'screen'
  const bx = w * BLOOM_CX_RATIO
  const by = h * BLOOM_CY_RATIO
  const br = Math.max(w, h) * BLOOM_R_RATIO
  const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, br)
  bloom.addColorStop(0.0, BLOOM_INNER)
  bloom.addColorStop(0.5, BLOOM_MID)
  bloom.addColorStop(1.0, 'rgba(255,220,196,0)')
  ctx.fillStyle = bloom
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'

  // 5 ─ Grain: whisper of dither so the rose gradient doesn't band on iOS.
  const grain = buildGrainPattern(ctx, rand)
  if (grain) {
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = GRAIN_ALPHA
    ctx.fillStyle = grain
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  return oc
}
