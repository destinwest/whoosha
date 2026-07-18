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
//   • JOY MOTES — a wind-blown field of soft luminous specks (dust caught in a
//     sunbeam — NOT hearts) streaming across the screen as if a warm breeze had
//     carried a handful of glowing particles across it. Each speck is a soft
//     glow stretched along the wind so it reads as blown, not static. Three
//     depth classes (tiny dust → mid motes → a few bright sparks), placed as a
//     mix of even scatter and a few gust clusters for streaky density. Alpha
//     eases down near dead-center so the traced heart track stays legible.
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

// ── Joy motes — a wind-blown field of light ─────────────────────────────────
// Soft luminous specks (NOT hearts) streaming across the field. Fixed seed →
// pixel-identical across re-bakes.
const FIELD_SEED = 0x10BE  // "love"

// Wind: a gentle breeze blowing rightward and slightly up — buoyant, calm.
const WIND_ANGLE = -15 * Math.PI / 180

// Gust clustering: a few seed points; a fraction of the motes cluster around
// them, smeared along the wind, so the field reads as blown in gusts rather
// than a uniform dusting. The rest are an even scatter for coverage.
const GUST_COUNT    = 6
const CLUSTER_FRAC  = 0.55   // share of motes that ride a gust vs. even scatter
const GUST_SPREAD   = 0.16   // gust radius as a fraction of min(w,h)
const GUST_ELONGATE = 2.6    // gust smear multiplier along the wind

// Alpha eases down inside this central radius (× half-min-side) so the traced
// heart stays legible; never a hard hole.
const CENTER_CLEAR_R = 0.42
const CENTER_MIN_MUL = 0.30

// Three depth classes, all screen-blended luminous dust: many tiny DUST specks
// far back, a body of mid MOTES, and a few larger bright SPARKS near the front.
// Streak = how far each speck is stretched along the wind (blown look).
const MOTE_BLEND = 'screen'
const CREAM      = '255,240,222'   // warm cream
const ROSEGOLD   = '255,212,182'   // rose-gold
const MOTE_CLASSES = [
  // count, size (× min side), alpha, streak, tint
  { count: 74, sMin: 0.006, sMax: 0.018, aMin: 0.05, aMax: 0.11, kMin: 1.6, kMax: 2.8, rgb: CREAM    },
  { count: 52, sMin: 0.020, sMax: 0.048, aMin: 0.07, aMax: 0.15, kMin: 1.5, kMax: 2.6, rgb: ROSEGOLD },
  { count: 20, sMin: 0.045, sMax: 0.090, aMin: 0.08, aMax: 0.16, kMin: 1.3, kMax: 2.2, rgb: CREAM    },
]

// ── Grain (anti-banding) ────────────────────────────────────────────────────
const GRAIN_TILE  = 128    // px; small noise tile, pattern-tiled across the field
const GRAIN_ALPHA = 0.035  // overlay-blended; adds dither, never visible as noise

// Draws one soft glow-speck stretched along the wind so it reads as blown: a
// radial gradient (bright core → transparent edge) drawn under an anisotropic
// scale, turning the circle into a soft comet-streak. size = core radius in px.
function drawStreakMote(ctx, cx, cy, size, streak, rgb, alpha) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(WIND_ANGLE)
  ctx.scale(streak, 1)                    // stretch along the wind
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size)
  g.addColorStop(0.0, `rgba(${rgb},${alpha.toFixed(3)})`)
  g.addColorStop(0.5, `rgba(${rgb},${(alpha * 0.5).toFixed(3)})`)
  g.addColorStop(1.0, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(-size, -size, size * 2, size * 2)
  ctx.restore()
}

// Fades motes that land over the central track so the traced heart stays clear.
function centerAtten(px, py, w, h) {
  const d = Math.hypot(px - w / 2, py - h / 2) / (Math.min(w, h) / 2)
  return CENTER_MIN_MUL + (1 - CENTER_MIN_MUL) * clamp(d / CENTER_CLEAR_R, 0, 1)
}

// Scatters one depth class across the wind-blown field: a fraction ride a gust
// (jitter around a seed, smeared along the wind), the rest scatter evenly across
// a slightly over-scanned rect so streaks enter and exit the edges.
function scatterWindField(ctx, rand, w, h, gusts, cls) {
  const minSide = Math.min(w, h)
  const cos = Math.cos(WIND_ANGLE)
  const sin = Math.sin(WIND_ANGLE)
  for (let i = 0; i < cls.count; i++) {
    let px, py
    if (rand() < CLUSTER_FRAC) {
      const g = gusts[(rand() * gusts.length) | 0]
      const along  = (rand() - 0.5) * 2 * GUST_SPREAD * GUST_ELONGATE * minSide
      const across = (rand() - 0.5) * 2 * GUST_SPREAD * minSide
      px = g.x + cos * along - sin * across
      py = g.y + sin * along + cos * across
    } else {
      px = (-0.1 + rand() * 1.2) * w
      py = (-0.1 + rand() * 1.2) * h
    }
    const size   = (cls.sMin + rand() * (cls.sMax - cls.sMin)) * minSide
    const streak = cls.kMin + rand() * (cls.kMax - cls.kMin)
    const alpha  = (cls.aMin + rand() * (cls.aMax - cls.aMin)) * centerAtten(px, py, w, h)
    drawStreakMote(ctx, px, py, size, streak, cls.rgb, alpha)
  }
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

  // 3 ─ Joy motes: a wind-blown field of luminous specks streaming across.
  const gusts = []
  for (let i = 0; i < GUST_COUNT; i++) gusts.push({ x: rand() * w, y: rand() * h })
  ctx.globalCompositeOperation = MOTE_BLEND
  for (const cls of MOTE_CLASSES) scatterWindField(ctx, rand, w, h, gusts, cls)
  ctx.globalCompositeOperation = 'source-over'

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
