// ── RainbowCanvas.jsx ─────────────────────────────────────────────────────────
// Rainbow Breathing canvas. Shares the groove-tracing core, heat gauge, synergy,
// bloom, particles and fingerprint with the other games (ported from
// HexagonCanvas), but diverges structurally in three ways, flagged with
// "── RAINBOW-SPECIFIC ──" headers:
//
//   1. The track is FOUR OPEN concentric semicircular arcs (a rainbow), not one
//      closed loop. Every groove helper here is the open-path variant: no seam,
//      no wraparound, no lap detection. The child traces whichever arc the
//      schedule says is active.
//   2. Pacing is a finite CLIMB SCHEDULE, not an endless cycle. Each arc runs
//      hold-left / breathe-in (left→right) / hold-right / breathe-out
//      (right→left) TWICE, at 2s per phase on the bottom (purple) arc, then
//      3s / 4s / 5s on the arcs above. After the top (red) arc's two cycles,
//      its 5s cycle repeats indefinitely. Holds are STATIONARY — the pacing
//      circle rests inside a cloud at the arc's end — except the hold before a
//      promotion, where it glides gently to the next arc's endpoint within the
//      cloud. The schedule clock starts at FIRST TOUCH, not mount, so the climb
//      never runs without the child.
//   3. Paint color is scheduled, not time-drifted: each crossing of an arc
//      paints the next of four shades of that arc's color (2 cycles = 4
//      crossings = all 4 shades; the looping top arc keeps cycling its four).
//
// Breathing labels are CANVAS text curved along the active arc (a DOM label
// can't follow the curve). The label previews the next breath during holds:
// entering the right cloud after a breathe-in, the arc text already reads
// "breathe out" — per the user's spec.
//
// Props:
//   strokeModeRef   — { current: 'classic' | 'watercolor' }
//   pacingCanvasRef — ref to the overlay canvas above the saturate wrapper
//   onGameStart()   — called once when the child first touches the track
//   interactive     — boolean; controls pointer events on the canvas element
//
// Imperative API (via ref):
//   reset()         — clears all canvas state and resets all game-state refs
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import * as stampStroke from '../square/strokes/stampStroke'
import * as layeredWash from '../square/strokes/layeredWash'

// ── RAINBOW-SPECIFIC: arcs + schedule ────────────────────────────────────────
const ARC_COUNT        = 4
// Per-arc phase duration, bottom (purple) → top (red). Every phase of an arc's
// cycle — hold, in, hold, out — shares the arc's duration.
const ARC_DURATIONS_MS = [2000, 3000, 4000, 5000]
const CYCLES_PER_ARC   = 2                        // in/out crossings per arc = 4

// The climb: a flat list of phases from first touch to the top of the rainbow.
//   type     — 'holdL' | 'in' | 'holdR' | 'out'
//   arc      — the ACTIVE arc (for holdL: the arc about to be breathed)
//   fromArc  — holdL only: the arc just finished, for the in-cloud glide
//   crossing — in/out only: 0-based crossing count within the arc (shade index)
const CLIMB_PHASES = []
for (let a = 0; a < ARC_COUNT; a++) {
  for (let c = 0; c < CYCLES_PER_ARC; c++) {
    const dur     = ARC_DURATIONS_MS[a]
    const fromArc = c === 0 ? Math.max(0, a - 1) : a
    CLIMB_PHASES.push({ type: 'holdL', arc: a, fromArc, dur })
    CLIMB_PHASES.push({ type: 'in',    arc: a, dur, crossing: c * 2 })
    CLIMB_PHASES.push({ type: 'holdR', arc: a, dur })
    CLIMB_PHASES.push({ type: 'out',   arc: a, dur, crossing: c * 2 + 1 })
  }
}
const CLIMB_STARTS = CLIMB_PHASES.reduce((acc, p, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + CLIMB_PHASES[i - 1].dur)
  return acc
}, [])
const CLIMB_MS = CLIMB_STARTS[CLIMB_PHASES.length - 1] + CLIMB_PHASES[CLIMB_PHASES.length - 1].dur
// Top-arc loop, repeated forever after the climb (keeps the full 5-5-5-5
// rhythm, holds included). `crossing` continues past the climb's so the four
// red shades keep cycling.
const TOP_ARC  = ARC_COUNT - 1
const LOOP_DUR = ARC_DURATIONS_MS[TOP_ARC]
const LOOP_MS  = 4 * LOOP_DUR

// getSchedule(elapsed) → the live phase descriptor:
//   { type, arc, fromArc?, crossing?, tNorm, dur, key }
// `key` uniquely identifies the phase instance (climb index, or loop count ×
// position) so the frame loop can edge-detect phase changes.
function getSchedule(elapsed) {
  if (elapsed < CLIMB_MS) {
    let i = CLIMB_PHASES.length - 1
    for (let j = 0; j < CLIMB_PHASES.length; j++) {
      if (elapsed < CLIMB_STARTS[j] + CLIMB_PHASES[j].dur) { i = j; break }
    }
    const p = CLIMB_PHASES[i]
    return { ...p, tNorm: (elapsed - CLIMB_STARTS[i]) / p.dur, key: i }
  }
  const past      = elapsed - CLIMB_MS
  const loopCount = Math.floor(past / LOOP_MS)
  const t         = past % LOOP_MS
  const idx       = Math.min(3, Math.floor(t / LOOP_DUR))
  const tNorm     = (t - idx * LOOP_DUR) / LOOP_DUR
  const key       = CLIMB_PHASES.length + loopCount * 4 + idx
  const baseCrossing = CYCLES_PER_ARC * 2 + loopCount * 2
  switch (idx) {
    case 0:  return { type: 'holdL', arc: TOP_ARC, fromArc: TOP_ARC, dur: LOOP_DUR, tNorm, key }
    case 1:  return { type: 'in',    arc: TOP_ARC, crossing: baseCrossing,     dur: LOOP_DUR, tNorm, key }
    case 2:  return { type: 'holdR', arc: TOP_ARC, dur: LOOP_DUR, tNorm, key }
    default: return { type: 'out',   arc: TOP_ARC, crossing: baseCrossing + 1, dur: LOOP_DUR, tNorm, key }
  }
}

// The resting state before first touch: holding in the left cloud at the
// bottom arc's start, label reading "breathe in".
const PRE_START_SCHED = { type: 'holdL', arc: 0, fromArc: 0, dur: ARC_DURATIONS_MS[0], tNorm: 0, key: -1 }

// ── RAINBOW-SPECIFIC: color families ─────────────────────────────────────────
// Band base colors, bottom → top (purple, green, yellow, red) — pastel and
// calm per the design system (no saturated brights). The four paint shades per
// arc are deeper variants of the band's base so the child's stroke reads
// against it; crossing 1 → shade 0 through crossing 4 → shade 3, then cycle.
const BAND_BASES = ['#CDB9E6', '#B5D9B7', '#F4E4A8', '#EFB3A6']
const PAINT_SHADES = [
  ['#B79BDC', '#A588D0', '#9174C2', '#7D62B0'],   // purples
  ['#9CCB9E', '#88BC8B', '#74AC79', '#619B67'],   // greens
  ['#EDD489', '#E3C570', '#D9B65A', '#CBA447'],   // honey golds
  ['#E89C8B', '#DE8875', '#D27461', '#C4614E'],   // dusty corals
]
// Curved-label ink per arc — deep, readable tones of each band family.
const LABEL_COLORS = ['#5F4692', '#3F7048', '#8F701F', '#93402F']

// Cloud fill + shading tones (baked once per resize).
const CLOUD_FILL   = '#FDFAF1'
const CLOUD_SHADOW = 'rgba(196,172,116,0.28)'

// Track slimming vs. the shared Square/Hexagon width handle — four stacked
// bands need to fit the screen half-height while leaving a visible inner sky.
const RAINBOW_TRACK_SLIM = 0.85

// ── Tracing core (open-path groove model) ────────────────────────────────────
const LEASH_TRACK_WIDTHS      = 1.4   // finger↔bead max arc-distance, in track widths
const ACCEPTANCE_TRACK_WIDTHS = 0.75  // finger↔groove max perpendicular distance, in track widths
// During cloud holds there is no groove: the child counts as "with" the pacing
// circle while the finger rests within this many track-widths of the hold spot.
const HOLD_RADIUS_TRACK_WIDTHS = 2.0

// ── Heat gauge tuning (identical to Hexagon) ─────────────────────────────────
const GAUGE_SPEED_THRESHOLD   = 1.2
const GAUGE_RECOVER_THRESHOLD = 3.0
const GAUGE_CHARGE_DELAY      = 1000
const GAUGE_DRAIN_DELAY       = 500
const GAUGE_EFFECT_THRESHOLD  = 0.3

// ── Synergy tuning (identical to Hexagon) ────────────────────────────────────
const SYNERGY_DIST_THRESHOLD_LW = 0.8
const SYNERGY_TIME_0_TO_1_MS    = 4000
const SYNERGY_TIME_1_TO_2_MS    = 4000
const SYNERGY_TIME_2_TO_3_MS    = 8000
const SYNERGY_TIME_3_TO_4_MS    = 16000
const SYNERGY_MAX_ACCUM_MS      = SYNERGY_TIME_0_TO_1_MS + SYNERGY_TIME_1_TO_2_MS
                                + SYNERGY_TIME_2_TO_3_MS + SYNERGY_TIME_3_TO_4_MS
const SYNERGY_RETURN_MS         = 3000
const SYNERGY_RETURN_RATE       = SYNERGY_MAX_ACCUM_MS / SYNERGY_RETURN_MS
const EMBER_PARTICLE_CAP        = 30
const EMBER_SPAWN_RATE_AT_FULL  = 14

// Label animation
const LABEL_ALPHA    = 0.85
const LABEL_FADE_MS  = 450    // crossfade when the text/arc changes

const smoothstep  = t => t * t * (3 - 2 * t)
const easeIn      = t => t * t * t
const easeOutSoft = t => 1 - Math.pow(1 - t, 2)

// ── lerpColor ─────────────────────────────────────────────────────────────────
function lerpColor(hexA, hexB, t) {
  const ar = parseInt(hexA.slice(1, 3), 16)
  const ag = parseInt(hexA.slice(3, 5), 16)
  const ab = parseInt(hexA.slice(5, 7), 16)
  const br = parseInt(hexB.slice(1, 3), 16)
  const bg = parseInt(hexB.slice(3, 5), 16)
  const bb = parseInt(hexB.slice(5, 7), 16)
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`
}

// ── buildGeo ──────────────────────────────────────────────────────────────────
// ── RAINBOW-SPECIFIC: geometry ───────────────────────────────────────────────
// Four concentric semicircular centerlines over a shared baseline center
// (cx, baseY), plus the two cloud footprints at the baseline ends. Each arc is
// sampled left→right over the top (canvas angle π → 2π) into its own open
// points/cumLen arrays for the groove helpers.
function buildGeo(rect) {
  const w  = rect.width
  const h  = rect.height
  const cx = w / 2

  // Size handle: rainbow width is the constraint on portrait screens; cap the
  // height share so clouds + rainbow sit comfortably. lw follows the shared
  // (2R)·0.0728 + 8 family, slimmed like the Star track.
  const size = Math.min(w * 0.92, h * 0.62)
  const lw   = (size * 0.0728 + 8) * RAINBOW_TRACK_SLIM
  const gap  = 0                        // bands sit flush — no sliver of sky dividing the levels
  const step = lw + gap

  const outerR = size / 2 - lw / 2                 // top (red) centerline radius
  const radii  = [outerR - 3 * step, outerR - 2 * step, outerR - step, outerR]

  // Vertical placement: center the rainbow + clouds block.
  const cloudDrop = lw * 1.6                       // clouds extend this far below baseline
  const blockH    = outerR + lw / 2 + cloudDrop
  const baseY     = (h - blockH) / 2 + outerR + lw / 2

  // Sampled open path per arc, left → right over the top.
  const N_PER_ARC = 240
  const arcs = radii.map((r) => {
    const points = []
    for (let i = 0; i <= N_PER_ARC; i++) {
      const th = Math.PI + (i / N_PER_ARC) * Math.PI   // π → 2π (top half, y-down canvas)
      points.push({ x: cx + r * Math.cos(th), y: baseY + r * Math.sin(th) })
    }
    const cumLen = new Array(N_PER_ARC + 1)
    cumLen[0] = 0
    for (let i = 0; i < N_PER_ARC; i++) {
      cumLen[i + 1] = cumLen[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    }
    return { r, points, cumLen, totalLen: cumLen[N_PER_ARC] }
  })

  // Cloud footprints — centered on the span of arc endpoints so every arc's
  // baseline end tucks into the cloud.
  const spanIn  = radii[0] - lw / 2
  const spanOut = radii[3] + lw / 2
  const cloudCxOff = (spanIn + spanOut) / 2
  const cloudW     = (spanOut - spanIn) * 1.5
  const clouds = [
    { cx: cx - cloudCxOff, cy: baseY + lw * 0.35, w: cloudW },   // left
    { cx: cx + cloudCxOff, cy: baseY + lw * 0.35, w: cloudW },   // right
  ]

  return { w, h, cx, baseY, lw, gap, radii, arcs, clouds, N: N_PER_ARC }
}

// Arc endpoint helpers — the hold anchors ARE the arc endpoints, so breath
// phases begin exactly where the hold rests (no jump; clouds hide the ends).
const leftEnd  = (geo, a) => ({ x: geo.cx - geo.radii[a], y: geo.baseY })
const rightEnd = (geo, a) => ({ x: geo.cx + geo.radii[a], y: geo.baseY })

// Point on arc `a` at breath progress s∈[0,1], left→right over the top.
function arcPointAt(geo, a, s) {
  const r  = geo.radii[a]
  const th = Math.PI + s * Math.PI
  return { x: geo.cx + r * Math.cos(th), y: geo.baseY + r * Math.sin(th) }
}

// ── Track + cloud bakes ───────────────────────────────────────────────────────
// Both are static scenery, baked into offscreen canvases at resize and drawn
// as bitmaps per frame (POLISH-STRATEGY hybrid rule). The clouds are a
// SEPARATE bake because the child's paint composites between them: arcs below,
// paint above arcs, clouds above paint (covering the painted arc ends).

function bakeTrack(geo, dpr) {
  const oc  = document.createElement('canvas')
  oc.width  = geo.w * dpr
  oc.height = geo.h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const { cx, baseY, radii, lw } = geo
  ctx.lineCap = 'butt'
  for (let a = 0; a < ARC_COUNT; a++) {
    const r    = radii[a]
    const base = BAND_BASES[a]

    // Single band body — a radial gradient across the band's width, DARKEST at
    // the inner (bottom) edge and lightening to the outer (top) edge. No drop
    // shadow and no inner-wall line: the bands sit flush (gap zeroed in
    // buildGeo), so the rainbow reads as one clean sweep of colour rather than
    // stacked, outlined channels.
    const grad = ctx.createRadialGradient(cx, baseY, r - lw / 2, cx, baseY, r + lw / 2)
    grad.addColorStop(0,   lerpColor(base, '#7A6136', 0.16))   // inner edge (bottom) — darkest
    grad.addColorStop(0.5, base)
    grad.addColorStop(1,   lerpColor(base, '#FFFFFF', 0.28))   // outer edge (top) — lightest
    ctx.beginPath()
    ctx.arc(cx, baseY, r, Math.PI, Math.PI * 2, false)
    ctx.lineWidth   = lw
    ctx.strokeStyle = grad
    ctx.stroke()
  }
  return oc
}

// One fluffy cloud: a union of overlapping puff circles filled flat, then a
// soft warm under-shade clipped inside the silhouette. All bake-time cost.
function drawCloud(ctx, { cx, cy, w }) {
  const rBig = w * 0.24
  const puffs = [
    { x: cx,            y: cy,               r: rBig },
    { x: cx - w * 0.28, y: cy + rBig * 0.22, r: rBig * 0.78 },
    { x: cx + w * 0.28, y: cy + rBig * 0.22, r: rBig * 0.78 },
    { x: cx - w * 0.14, y: cy - rBig * 0.52, r: rBig * 0.66 },
    { x: cx + w * 0.16, y: cy - rBig * 0.46, r: rBig * 0.60 },
  ]

  // Soft ground shadow beneath the cloud.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy + rBig * 0.9, w * 0.42, rBig * 0.35, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(160,132,72,0.10)'
  ctx.fill()
  ctx.restore()

  // Silhouette (union of puffs).
  ctx.save()
  ctx.beginPath()
  for (const p of puffs) {
    ctx.moveTo(p.x + p.r, p.y)
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
  }
  ctx.fillStyle = CLOUD_FILL
  ctx.fill()

  // Bottom inner shading, clipped to the silhouette.
  ctx.clip()
  const shade = ctx.createLinearGradient(0, cy - rBig, 0, cy + rBig * 1.2)
  shade.addColorStop(0,    'rgba(0,0,0,0)')
  shade.addColorStop(0.65, 'rgba(0,0,0,0)')
  shade.addColorStop(1,    CLOUD_SHADOW)
  ctx.fillStyle = shade
  ctx.fillRect(cx - w, cy - rBig * 2, w * 2, rBig * 4)
  ctx.restore()
}

function bakeClouds(geo, dpr) {
  const oc  = document.createElement('canvas')
  oc.width  = geo.w * dpr
  oc.height = geo.h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)
  for (const c of geo.clouds) drawCloud(ctx, c)
  return oc
}

// ── applyPaintClip ────────────────────────────────────────────────────────────
// Permanent clip: the union of the four half-annulus bands (device px), so
// paint can never bleed into the sky or the gaps between bands. save() is
// intentionally never restored — the clip persists (same as the other games).
function applyPaintClip(ctx, { cx, baseY, radii, lw }) {
  ctx.save()
  ctx.beginPath()
  for (const r of radii) {
    const ro = r + lw / 2 + 0.5
    const ri = Math.max(0, r - lw / 2 - 0.5)
    ctx.moveTo(cx + ro, baseY)
    ctx.arc(cx, baseY, ro, Math.PI * 2, Math.PI, true)    // outer edge, right→left over the top
    ctx.lineTo(cx - ri, baseY)
    ctx.arc(cx, baseY, ri, Math.PI, Math.PI * 2, false)   // inner edge, left→right back
    ctx.closePath()
  }
  ctx.clip()
}

// ── Open-path groove helpers ──────────────────────────────────────────────────
// Same shape as the Hexagon/Square helpers but WITHOUT wraparound — each arc
// is an open path with two real ends. All take one arc's { points, cumLen }.

function lerpCumLen(cumLen, idx) {
  const N = cumLen.length - 1
  const i = Math.max(0, Math.min(N - 1, Math.floor(idx)))
  const t = idx - i
  return cumLen[i] + (cumLen[i + 1] - cumLen[i]) * t
}

// Signed arc distance (px) from index a to index b — no wrap on an open path.
function arcGapPx(arc, aIdx, bIdx) {
  return lerpCumLen(arc.cumLen, bIdx) - lerpCumLen(arc.cumLen, aIdx)
}

function pointAt(points, idx) {
  const N = points.length - 1
  const i = Math.max(0, Math.min(N - 1, Math.floor(idx)))
  const t = idx - i
  const a = points[i]
  const b = points[i + 1]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// Local projection around the bead (leash window), open path.
function projectLocal(arc, centerIdx, px, py, windowPx) {
  const { points, cumLen } = arc
  const N = points.length - 1
  const centerLen = lerpCumLen(cumLen, centerIdx)

  let best = null
  for (let i = 0; i < N; i++) {
    if (Math.abs(cumLen[i] - centerLen) > windowPx) continue
    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const lsq = dx * dx + dy * dy
    if (lsq === 0) continue
    const t  = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lsq))
    const nx = a.x + t * dx, ny = a.y + t * dy
    const d  = Math.hypot(px - nx, py - ny)
    if (!best || d < best.perpDist) best = { idx: i + t, x: nx, y: ny, perpDist: d }
  }
  return best
}

// Global nearest projection on one arc — first touch / re-touch / arc change.
function projectGlobal(arc, px, py) {
  const { points } = arc
  const N = points.length - 1
  let best = null
  for (let i = 0; i < N; i++) {
    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const lsq = dx * dx + dy * dy
    if (lsq === 0) continue
    const t  = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lsq))
    const nx = a.x + t * dx, ny = a.y + t * dy
    const d  = Math.hypot(px - nx, py - ny)
    if (!best || d < best.perpDist) best = { idx: i + t, x: nx, y: ny, perpDist: d }
  }
  return best
}

// ── Curved label ──────────────────────────────────────────────────────────────
// Draws `text` centered on arc `a`'s apex, each character positioned on the
// centerline and rotated to the local tangent, reading left→right. Pure
// fillText calls (~11/frame at most two labels during a crossfade) — well
// under the per-frame JS budget; nothing here allocates canvases or filters.
function drawArcLabel(ctx, geo, a, text, alpha, fontPx) {
  if (alpha <= 0.01) return
  const r = geo.radii[a]
  ctx.save()
  ctx.font         = `700 ${fontPx}px 'Nunito', sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = LABEL_COLORS[a]
  ctx.globalAlpha  = alpha

  const widths = [...text].map(ch => ctx.measureText(ch).width)
  const tracking = fontPx * 0.06
  const totalW   = widths.reduce((s, w) => s + w, 0) + tracking * (text.length - 1)
  // Characters advance clockwise (left→right across the apex). Canvas apex
  // angle is 3π/2; start half the text-arc before it.
  let ang = 3 * Math.PI / 2 - (totalW / 2) / r
  for (let i = 0; i < text.length; i++) {
    const chAng = ang + (widths[i] / 2) / r
    const x = geo.cx   + r * Math.cos(chAng)
    const y = geo.baseY + r * Math.sin(chAng)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(chAng + Math.PI / 2)   // local tangent, upright at the apex
    ctx.fillText(text[i], 0, 0)
    ctx.restore()
    ang = chAng + (widths[i] / 2 + tracking) / r
  }
  ctx.restore()
}

// ── RainbowCanvas ─────────────────────────────────────────────────────────────
const RainbowCanvas = forwardRef(function RainbowCanvas(
  { strokeModeRef, pacingCanvasRef, onGameStart, interactive },
  ref,
) {
  // ── Canvas infrastructure ──────────────────────────────────────────────────
  const canvasRef    = useRef(null)
  const paintRef     = useRef(null)
  const rafRef       = useRef(null)
  const geoRef       = useRef(null)
  const dprRef       = useRef(window.devicePixelRatio || 1)
  const paintCtxRef  = useRef(null)
  const clipArgsRef  = useRef(null)
  const trackBakeRef = useRef(null)   // baked rainbow bands bitmap
  const cloudBakeRef = useRef(null)   // baked clouds bitmap

  // ── Game state refs ────────────────────────────────────────────────────────
  const gameStartRef  = useRef(null)   // schedule clock — starts at FIRST TOUCH
  const startedRef    = useRef(false)
  const touchRef      = useRef(false)
  const childPosRef   = useRef(null)
  const fingerPosRef  = useRef(null)
  const tracingRef    = useRef(false)
  const beadIdxRef    = useRef(null)   // float index into the ACTIVE arc's points
  const beadArcRef    = useRef(0)      // which arc the bead lives on
  const schedKeyRef   = useRef(null)   // previous frame's phase key (edge detect)
  const prevArcRef    = useRef(0)      // previous frame's active arc (promotion detect)
  const paintColorRef = useRef(PAINT_SHADES[0][0])

  const encouragementRef     = useRef(null)
  const fpImgRef             = useRef(null)
  const fpImgReadyRef        = useRef(false)
  const fingerprintActiveRef = useRef(true)
  const fpDismissTRef        = useRef(0)
  const fpDismissingRef      = useRef(false)
  const touchActiveRef       = useRef(false)
  const lastTouchRef         = useRef({ x: 0, y: 0 })
  const bloomFadeRef         = useRef(1)
  const bloomFadingRef       = useRef(false)
  const bloomAttackRef       = useRef(0)
  const paintPressureRef     = useRef(0)
  const particlesRef         = useRef([])
  const particleFrameRef     = useRef(0)
  const lastTouchTimeRef     = useRef(0)
  const fingerSpeedRef       = useRef(0)
  const trackTangentRef      = useRef({ x: 1, y: 0 })
  const dismissRafRef        = useRef(null)
  const bloomFadeRafRef      = useRef(null)
  const bloomAttackRafRef    = useRef(null)
  const paintPressureRafRef  = useRef(null)

  // Label crossfade state: current {text, arc} plus the fading previous one.
  const labelRef     = useRef({ text: 'breathe in', arc: 0 })
  const labelPrevRef = useRef(null)     // { text, arc, start } while fading out

  // ── Heat gauge ────────────────────────────────────────────────────────────
  const heatGaugeRef      = useRef(0)
  const tooFastTimerRef   = useRef(0)
  const goodPaceTimerRef  = useRef(0)
  const gaugeActiveRef    = useRef(false)
  const gaugeEffectRef    = useRef(0)
  const childPathRateRef  = useRef(0)
  const pacingEmphasisRef = useRef(0)
  // ── Synergy ───────────────────────────────────────────────────────────────
  const synergyStageRef   = useRef(0)
  const onPaceAccumRef    = useRef(0)
  const emberParticlesRef = useRef([])
  const lastEmberSpawnRef = useRef(0)

  // ── Fingerprint image loader ────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      fpImgRef.current      = img
      fpImgReadyRef.current = true
    }
    img.src = '/assets/fingerprint.png'
  }, [])

  // ── Imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    reset() {
      stampStroke.clear()
      if (paintCtxRef.current && clipArgsRef.current) {
        applyPaintClip(paintCtxRef.current, clipArgsRef.current)
      }
      layeredWash.clear()

      startedRef.current    = false
      touchRef.current      = false
      childPosRef.current   = null
      fingerPosRef.current  = null
      tracingRef.current    = false
      beadIdxRef.current    = null
      beadArcRef.current    = 0
      gameStartRef.current  = null
      schedKeyRef.current   = null
      prevArcRef.current    = 0
      paintColorRef.current = PAINT_SHADES[0][0]
      encouragementRef.current = null
      labelRef.current      = { text: 'breathe in', arc: 0 }
      labelPrevRef.current  = null

      fingerprintActiveRef.current = true
      fpDismissTRef.current        = 0
      fpDismissingRef.current      = false
      touchActiveRef.current       = false
      bloomFadeRef.current         = 1
      bloomFadingRef.current       = false
      lastTouchRef.current         = { x: 0, y: 0 }
      bloomAttackRef.current       = 0
      paintPressureRef.current     = 0
      particlesRef.current         = []
      particleFrameRef.current     = 0
      fingerSpeedRef.current       = 0
      cancelAnimationFrame(dismissRafRef.current)
      cancelAnimationFrame(bloomFadeRafRef.current)
      cancelAnimationFrame(bloomAttackRafRef.current)
      cancelAnimationFrame(paintPressureRafRef.current)

      heatGaugeRef.current      = 0
      tooFastTimerRef.current   = 0
      goodPaceTimerRef.current  = 0
      gaugeActiveRef.current    = false
      gaugeEffectRef.current    = 0
      childPathRateRef.current  = 0
      pacingEmphasisRef.current = 0
      synergyStageRef.current   = 0
      onPaceAccumRef.current    = 0
      emberParticlesRef.current = []
      lastEmberSpawnRef.current = 0
      document.documentElement.style.setProperty('--game-saturation', '1')
    },
  }), [])

  // ── RAINBOW-SPECIFIC: pacing position from the schedule ────────────────────
  // Breaths sweep the active arc at constant speed. Holds rest at the arc's
  // endpoint inside the cloud; a promotion hold glides from the finished arc's
  // endpoint to the next arc's over the first 40% of the hold (a slow drift
  // inside the cloud — the only moment the pacing circle changes arcs).
  function getPacingPos(geo, sched) {
    switch (sched.type) {
      case 'in':  return arcPointAt(geo, sched.arc, sched.tNorm)
      case 'out': return arcPointAt(geo, sched.arc, 1 - sched.tNorm)
      case 'holdR': return rightEnd(geo, sched.arc)
      case 'holdL': {
        const from = leftEnd(geo, sched.fromArc)
        const to   = leftEnd(geo, sched.arc)
        if (sched.fromArc === sched.arc) return to
        const g = smoothstep(Math.min(1, sched.tNorm / 0.4))
        return { x: from.x + (to.x - from.x) * g, y: from.y + (to.y - from.y) * g }
      }
      default: return leftEnd(geo, 0)
    }
  }

  // ── Phase-change bookkeeping ───────────────────────────────────────────────
  // Runs once per phase boundary: sets the paint shade for breath phases,
  // parks the bead at the hold endpoint, retargets the label (crossfade), and
  // fires the encouragement moment on arc promotion.
  function handlePhaseChange(geo, sched, now) {
    // Paint shade for this crossing.
    if (sched.type === 'in' || sched.type === 'out') {
      const shade = PAINT_SHADES[sched.arc][sched.crossing % 4]
      paintColorRef.current = shade
      stampStroke.updateColor(shade)
      layeredWash.updateColor(shade)
    }

    // Label: holds preview the NEXT breath (entering the right cloud after a
    // breathe-in, the arc already reads "breathe out" — per spec).
    const text = (sched.type === 'holdL' || sched.type === 'in') ? 'breathe in' : 'breathe out'
    const cur  = labelRef.current
    if (cur.text !== text || cur.arc !== sched.arc) {
      labelPrevRef.current = { ...cur, start: now }
      labelRef.current     = { text, arc: sched.arc }
    }

    // Promotion → encouragement, if the child is with the pacing circle.
    if (sched.arc > prevArcRef.current) {
      const child  = childPosRef.current
      const pacing = getPacingPos(geo, sched)
      if (child && Math.hypot(child.x - pacing.x, child.y - pacing.y) <= 60) {
        encouragementRef.current = { startTime: now }
      }
    }
    prevArcRef.current = sched.arc

    // Park / re-home the bead for the new phase while the finger is down.
    if (touchRef.current && fingerPosRef.current) {
      const arcGeo = geo.arcs[sched.arc]
      if (sched.type === 'in' || sched.type === 'out') {
        const fp   = fingerPosRef.current
        const proj = projectGlobal(arcGeo, fp.x, fp.y)
        if (proj && proj.perpDist <= geo.lw * ACCEPTANCE_TRACK_WIDTHS * 1.5) {
          // Fresh stroke on the (possibly new) arc — pen up, then down at proj.
          stampStroke.lift()
          layeredWash.lift()
          beadArcRef.current = sched.arc
          beadIdxRef.current = proj.idx
          childPosRef.current = { x: proj.x, y: proj.y }
        } else {
          beadIdxRef.current = null   // finger away — bead re-attaches on approach
          beadArcRef.current = sched.arc
        }
      } else {
        // Hold: bead rests at the endpoint; no painting until the next breath.
        stampStroke.lift()
        layeredWash.lift()
        beadArcRef.current = sched.arc
        beadIdxRef.current = sched.type === 'holdR' ? geo.N : 0
      }
    } else {
      beadArcRef.current = sched.arc
      beadIdxRef.current = null
    }
  }

  // ── paintBeadSegment (open path) ───────────────────────────────────────────
  function paintBeadSegment(arcGeo, fromIdx, toIdx) {
    const { points } = arcGeo
    const dir = toIdx >= fromIdx ? 1 : -1
    let i     = Math.round(fromIdx)
    const end = Math.round(toIdx)
    while (i !== end) {
      i += dir
      addStrokePoint(points[i].x, points[i].y, 0)
    }
    const ep = pointAt(points, toIdx)
    addStrokePoint(ep.x, ep.y, 0)
  }

  // ── Stroke delegation ──────────────────────────────────────────────────────
  function addStrokePoint(x, y, vel) {
    if (gaugeActiveRef.current) return
    if (strokeModeRef.current === 'watercolor') {
      layeredWash.addPoint(x, y, vel)
    } else {
      stampStroke.addPoint(x, y, vel, paintPressureRef.current)
    }
  }

  // ── Paint pressure ramp ────────────────────────────────────────────────────
  function startPressureRamp() {
    paintPressureRef.current = 0
    cancelAnimationFrame(paintPressureRafRef.current)
    const pressureStart = performance.now()
    function pressureTick(now) {
      const t = Math.min(1, (now - pressureStart) / 100)
      paintPressureRef.current = easeOutSoft(t)
      if (t < 1) paintPressureRafRef.current = requestAnimationFrame(pressureTick)
      else paintPressureRef.current = 1
    }
    paintPressureRafRef.current = requestAnimationFrame(pressureTick)
  }

  // ── Bloom attack ramp ──────────────────────────────────────────────────────
  function startBloomAttack() {
    bloomAttackRef.current = 0
    cancelAnimationFrame(bloomAttackRafRef.current)
    const attackStart = performance.now()
    function attackTick(ts) {
      const t = Math.min(1, (ts - attackStart) / 180)
      bloomAttackRef.current = easeOutSoft(t)
      if (t < 1) bloomAttackRafRef.current = requestAnimationFrame(attackTick)
      else bloomAttackRef.current = 1
    }
    bloomAttackRafRef.current = requestAnimationFrame(attackTick)
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function currentSched() {
    return startedRef.current
      ? getSchedule(performance.now() - gameStartRef.current)
      : PRE_START_SCHED
  }

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return

    fingerPosRef.current = { x: px, y: py }

    if (!startedRef.current) {
      // First touch must land on the bottom arc (its left endpoint is where
      // the fingerprint pulses). The schedule clock starts here.
      const proj = projectGlobal(geo.arcs[0], px, py)
      if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return

      startedRef.current   = true
      gameStartRef.current = performance.now()
      touchRef.current     = true
      onGameStart?.()

      beadArcRef.current  = 0
      beadIdxRef.current  = proj.idx
      childPosRef.current = { x: proj.x, y: proj.y }
      startPressureRamp()

      fingerprintActiveRef.current = false
      fpDismissingRef.current      = true
      fpDismissTRef.current        = 0
      touchActiveRef.current       = true
      lastTouchRef.current         = { x: proj.x, y: proj.y }
      startBloomAttack()

      cancelAnimationFrame(dismissRafRef.current)
      const dismissStart = performance.now()
      function dismissTick(ts) {
        const t = Math.min(1, (ts - dismissStart) / 400)
        fpDismissTRef.current = easeIn(t)
        if (t < 1) {
          dismissRafRef.current = requestAnimationFrame(dismissTick)
        } else {
          fpDismissingRef.current = false
          fpDismissTRef.current   = 1
        }
      }
      dismissRafRef.current = requestAnimationFrame(dismissTick)

    } else {
      // Re-touch after a lift — resume on the ACTIVE arc (or the hold spot).
      const sched  = currentSched()
      const arcGeo = geoRef.current.arcs[sched.arc]
      const proj   = projectGlobal(arcGeo, px, py)
      if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return

      beadArcRef.current   = sched.arc
      beadIdxRef.current   = proj.idx
      childPosRef.current  = { x: proj.x, y: proj.y }
      lastTouchRef.current = { x: proj.x, y: proj.y }
      if (sched.type === 'in' || sched.type === 'out') {
        addStrokePoint(proj.x, proj.y, 0)
      }

      touchRef.current       = true
      startPressureRamp()
      touchActiveRef.current = true
      bloomFadingRef.current = false
      bloomFadeRef.current   = 1
      cancelAnimationFrame(bloomFadeRafRef.current)
      startBloomAttack()
    }
  }

  function onPointerMove(px, py) {
    if (!touchRef.current) return
    fingerPosRef.current = { x: px, y: py }
  }

  function onPointerUp() {
    touchRef.current         = false
    touchActiveRef.current   = false
    tracingRef.current       = false
    particleFrameRef.current = 0
    childPathRateRef.current = 0
    stampStroke.lift()
    layeredWash.lift()

    if (!startedRef.current) return
    bloomFadeRef.current   = 1
    bloomFadingRef.current = true
    cancelAnimationFrame(bloomFadeRafRef.current)
    const fadeStart = performance.now()
    function bloomFadeTick(ts) {
      const t = Math.min(1, (ts - fadeStart) / 900)
      bloomFadeRef.current = easeOutSoft(1 - t)
      if (t < 1) {
        bloomFadeRafRef.current = requestAnimationFrame(bloomFadeTick)
      } else {
        bloomFadeRef.current   = 0
        bloomFadingRef.current = false
      }
    }
    bloomFadeRafRef.current = requestAnimationFrame(bloomFadeTick)
  }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

  // ── Particle helpers ───────────────────────────────────────────────────────
  function emitParticle(x, y, moving, lw) {
    const tangent = trackTangentRef.current
    const normal  = { x: -tangent.y, y: tangent.x }

    let vx, vy
    if (moving) {
      const speed       = 0.04 + Math.random() * 0.06
      const tangentBias = (Math.random() - 0.5) * 2
      const normalBias  = (Math.random() - 0.5) * 0.6
      vx = (tangent.x * tangentBias + normal.x * normalBias) * speed
      vy = (tangent.y * tangentBias + normal.y * normalBias) * speed
    } else {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.02 + Math.random() * 0.03
      vx = Math.cos(angle) * speed
      vy = Math.sin(angle) * speed
    }

    const life = moving
      ? 500 + Math.random() * 300
      : 700 + Math.random() * 400

    particlesRef.current.push({ x, y, vx, vy, life, maxLife: life,
      size: lw * (0.04 + Math.random() * 0.04) })

    if (particlesRef.current.length > 40) particlesRef.current.shift()
  }

  function updateAndDrawParticles(ctx, lw, dt) {
    particlesRef.current = particlesRef.current.filter(p => p.life > 0)

    for (const p of particlesRef.current) {
      p.x    += p.vx * dt
      p.y    += p.vy * dt
      p.life -= dt
      p.vy   -= 0.0002

      const lifeT         = p.life / p.maxLife
      const particleAlpha = Math.min(1, lifeT * 3) * lifeT
      if (particleAlpha < 0.01) continue

      const radius = p.size * (0.6 + lifeT * 0.4)
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
      g.addColorStop(0,   `rgba(255,220,140,${(particleAlpha * 0.9).toFixed(3)})`)
      g.addColorStop(0.5, `rgba(212,160,86,${(particleAlpha * 0.5).toFixed(3)})`)
      g.addColorStop(1,   'rgba(212,160,86,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Main animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    const paintCanvas = document.createElement('canvas')
    paintRef.current  = paintCanvas

    let lastW = 0, lastH = 0

    function resize() {
      dprRef.current = window.devicePixelRatio || 1
      const dpr      = dprRef.current
      const rect     = { width: canvas.offsetWidth, height: canvas.offsetHeight }
      if (rect.width === 0 || rect.height === 0) return
      if (rect.width === lastW && rect.height === lastH) return
      lastW = rect.width
      lastH = rect.height

      canvas.width       = rect.width  * dpr
      canvas.height      = rect.height * dpr
      paintCanvas.width  = rect.width  * dpr
      paintCanvas.height = rect.height * dpr

      const pacingCanvas = pacingCanvasRef?.current
      if (pacingCanvas) {
        pacingCanvas.width  = rect.width  * dpr
        pacingCanvas.height = rect.height * dpr
      }

      const geo = buildGeo(rect)
      geoRef.current = geo

      const paintCtx = paintCanvas.getContext('2d')
      paintCtxRef.current = paintCtx

      // Paint clip in device px.
      const clipArgs = {
        cx:    geo.cx * dpr,
        baseY: geo.baseY * dpr,
        radii: geo.radii.map(r => r * dpr),
        lw:    geo.lw * dpr,
      }
      clipArgsRef.current = clipArgs
      applyPaintClip(paintCtx, clipArgs)

      // Static scenery bakes — per-frame cost is two drawImage calls.
      trackBakeRef.current = bakeTrack(geo, dpr)
      cloudBakeRef.current = bakeClouds(geo, dpr)

      const color = paintColorRef.current
      stampStroke.init({ paintCtx, lw: geo.lw, dpr, color })
      layeredWash.init({ paintCtx, lw: geo.lw, dpr, color, clipArgs })
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let prevFrameTime = 0

    function frame() {
      rafRef.current = requestAnimationFrame(frame)

      const geo = geoRef.current
      if (!geo) return

      const now = performance.now()
      const dt  = prevFrameTime > 0 ? Math.min(now - prevFrameTime, 50) : 16.67
      prevFrameTime = now

      const dpr = dprRef.current
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { lw } = geo

      const gaugeEffect = gaugeEffectRef.current

      // ── Schedule + pacing position ────────────────────────────────────────
      const sched = startedRef.current
        ? getSchedule(now - gameStartRef.current)
        : PRE_START_SCHED
      if (sched.key !== schedKeyRef.current) {
        handlePhaseChange(geo, sched, now)
        schedKeyRef.current = sched.key
      }
      const pacingPos = getPacingPos(geo, sched)
      const isHold    = sched.type === 'holdL' || sched.type === 'holdR'
      const activeArc = geo.arcs[sched.arc]

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 1. Rainbow bands (baked) ──────────────────────────────────────────
      if (trackBakeRef.current) ctx.drawImage(trackBakeRef.current, 0, 0, W, H)

      // ── 2. Paint layer ────────────────────────────────────────────────────
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      if (strokeModeRef.current === 'watercolor') {
        ctx.globalAlpha = 1 - gaugeEffect
        const wLayers = layeredWash.getLayers()
        for (const { canvas: lc } of wLayers) {
          ctx.drawImage(lc, 0, 0, W, H)
        }
      } else {
        ctx.globalAlpha = stampStroke.COMPOSITE_ALPHA * (1 - gaugeEffect)
        ctx.drawImage(paintCanvas, 0, 0, W, H)
      }
      ctx.restore()

      // ── 3. Clouds (baked) — cover the arc ends and any paint under them ───
      if (cloudBakeRef.current) ctx.drawImage(cloudBakeRef.current, 0, 0, W, H)

      // ── Bead tracing ──────────────────────────────────────────────────────
      // Breath phases use the open-path groove model on the active arc. Hold
      // phases have no groove: the child "holds" by resting the finger near
      // the pacing circle's cloud spot, which counts as on-pace for synergy.
      tracingRef.current = false
      if (startedRef.current && touchRef.current && fingerPosRef.current) {
        const fp = fingerPosRef.current

        if (isHold) {
          const holdR = lw * HOLD_RADIUS_TRACK_WIDTHS
          if (Math.hypot(fp.x - pacingPos.x, fp.y - pacingPos.y) <= holdR) {
            childPosRef.current = { x: pacingPos.x, y: pacingPos.y }
            tracingRef.current  = true
          }
          childPathRateRef.current = 0
        } else {
          const leashPx  = lw * LEASH_TRACK_WIDTHS
          const acceptPx = lw * ACCEPTANCE_TRACK_WIDTHS

          // Re-attach if the bead detached (or never attached on this arc).
          if (beadIdxRef.current === null || beadArcRef.current !== sched.arc) {
            const proj = projectGlobal(activeArc, fp.x, fp.y)
            if (proj && proj.perpDist <= acceptPx) {
              beadArcRef.current  = sched.arc
              beadIdxRef.current  = proj.idx
              childPosRef.current = { x: proj.x, y: proj.y }
              addStrokePoint(proj.x, proj.y, 0)
            }
          }

          if (beadIdxRef.current !== null && beadArcRef.current === sched.arc) {
            const proj = projectLocal(activeArc, beadIdxRef.current, fp.x, fp.y, leashPx)
            if (proj && proj.perpDist <= acceptPx) {
              const prevIdx = beadIdxRef.current
              const newIdx  = proj.idx

              // Bead velocity in arc-fractions/ms (whole arc = 1), smoothed.
              const gapFrac = arcGapPx(activeArc, prevIdx, newIdx) / activeArc.totalLen
              if (dt > 0) {
                childPathRateRef.current = childPathRateRef.current * 0.5 + (Math.abs(gapFrac) / dt) * 0.5
              }

              paintBeadSegment(activeArc, prevIdx, newIdx)
              beadIdxRef.current  = newIdx
              childPosRef.current = { x: proj.x, y: proj.y }

              const prevTouch = lastTouchRef.current
              lastTouchRef.current = { x: proj.x, y: proj.y }
              if (prevTouch) {
                const ddx = proj.x - prevTouch.x, ddy = proj.y - prevTouch.y
                const len = Math.hypot(ddx, ddy)
                if (len > 0.5) {
                  trackTangentRef.current = { x: ddx / len, y: ddy / len }
                  if (dt > 0) fingerSpeedRef.current = fingerSpeedRef.current * 0.7 + (len / dt) * 0.3
                  lastTouchTimeRef.current = now
                }
              }

              tracingRef.current = true
            }
          }
        }
      }
      if (!tracingRef.current) {
        childPathRateRef.current = 0
      }

      // ── Heat gauge update ─────────────────────────────────────────────────
      if (startedRef.current) {
        // Pacing rate on the active arc: 1 arc-fraction per ARC duration.
        const pacingRate = 1 / sched.dur
        const speedRatio = childPathRateRef.current / pacingRate

        const isTooFast  = tracingRef.current && speedRatio > GAUGE_SPEED_THRESHOLD
        const isGoodPace = !tracingRef.current || speedRatio <= GAUGE_SPEED_THRESHOLD

        if (isTooFast) {
          tooFastTimerRef.current = Math.min(GAUGE_CHARGE_DELAY, tooFastTimerRef.current + dt)
        } else if (isGoodPace && !gaugeActiveRef.current) {
          tooFastTimerRef.current = Math.max(0, tooFastTimerRef.current - dt * 0.5)
        }

        const isTrulyRacing = tracingRef.current && speedRatio > GAUGE_RECOVER_THRESHOLD
        if (isTrulyRacing) {
          goodPaceTimerRef.current = 0
        } else {
          goodPaceTimerRef.current = Math.min(GAUGE_DRAIN_DELAY, goodPaceTimerRef.current + dt)
        }

        if (isTooFast && !gaugeActiveRef.current && tooFastTimerRef.current >= GAUGE_CHARGE_DELAY) {
          heatGaugeRef.current = Math.min(1, heatGaugeRef.current + dt / 4000)
          if (heatGaugeRef.current >= 1) {
            gaugeActiveRef.current = true
            stampStroke.clear()
            if (paintCtxRef.current && clipArgsRef.current) {
              applyPaintClip(paintCtxRef.current, clipArgsRef.current)
            }
          }
        } else if (isGoodPace && !gaugeActiveRef.current && heatGaugeRef.current > 0) {
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 2000)
        } else if (gaugeActiveRef.current && goodPaceTimerRef.current >= GAUGE_DRAIN_DELAY) {
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 2000)
          if (heatGaugeRef.current <= 0) {
            gaugeActiveRef.current   = false
            goodPaceTimerRef.current = 0
          }
        }

        heatGaugeRef.current = Math.max(0, Math.min(1, heatGaugeRef.current))

        const g   = heatGaugeRef.current
        const gFx = g < GAUGE_EFFECT_THRESHOLD
          ? 0
          : Math.pow((g - GAUGE_EFFECT_THRESHOLD) / (1 - GAUGE_EFFECT_THRESHOLD), 2)

        gaugeEffectRef.current = gFx
        document.documentElement.style.setProperty('--game-saturation', (1 - gFx * 0.9).toFixed(3))
      }

      // ── Synergy update ────────────────────────────────────────────────────
      if (!tracingRef.current || gaugeActiveRef.current) {
        onPaceAccumRef.current = Math.max(
          0, onPaceAccumRef.current - dt * SYNERGY_RETURN_RATE,
        )
      } else if (startedRef.current && childPosRef.current) {
        const child      = childPosRef.current
        const dist       = Math.hypot(child.x - pacingPos.x, child.y - pacingPos.y)
        const speedRatio = childPathRateRef.current * sched.dur
        const close      = dist <= lw * SYNERGY_DIST_THRESHOLD_LW * (isHold ? HOLD_RADIUS_TRACK_WIDTHS : 1)
        const inPace     = speedRatio <= GAUGE_SPEED_THRESHOLD
        if (close && inPace) {
          onPaceAccumRef.current = Math.min(SYNERGY_MAX_ACCUM_MS, onPaceAccumRef.current + dt)
        } else {
          onPaceAccumRef.current = Math.max(0, onPaceAccumRef.current - dt)
        }
      }

      {
        const a  = onPaceAccumRef.current
        const t1 = SYNERGY_TIME_0_TO_1_MS
        const t2 = t1 + SYNERGY_TIME_1_TO_2_MS
        const t3 = t2 + SYNERGY_TIME_2_TO_3_MS
        const t4 = t3 + SYNERGY_TIME_3_TO_4_MS
        if      (a >= t4) synergyStageRef.current = 4
        else if (a >= t3) synergyStageRef.current = 3 + (a - t3) / SYNERGY_TIME_3_TO_4_MS
        else if (a >= t2) synergyStageRef.current = 2 + (a - t2) / SYNERGY_TIME_2_TO_3_MS
        else if (a >= t1) synergyStageRef.current = 1 + (a - t1) / SYNERGY_TIME_1_TO_2_MS
        else              synergyStageRef.current = a / SYNERGY_TIME_0_TO_1_MS
      }

      const synStage   = synergyStageRef.current
      const synStage01 = Math.min(1, synStage)
      const synStage12 = Math.max(0, Math.min(1, synStage - 1))
      const synStage23 = Math.max(0, Math.min(1, synStage - 2))
      const synStage34 = Math.max(0, Math.min(1, synStage - 3))

      // ── 4. Touch bloom ────────────────────────────────────────────────────
      {
        const showBloom = touchActiveRef.current || bloomFadingRef.current || fpDismissingRef.current
        if (showBloom) {
          const { x: tx, y: ty } = lastTouchRef.current
          const bloomScale = fpDismissingRef.current ? fpDismissTRef.current : 1
          const alpha      = bloomAttackRef.current * bloomFadeRef.current

          const synergyScale = (1 + 0.55 * synStage01) * (1 + 0.5 * synStage23)
          const innerR = lw * 0.4 * bloomScale * synergyScale
          const outerR = lw * 1.1 * bloomScale * synergyScale

          if (outerR > 0.5) {
            const sb        = synStage01
            const aMid      = (0.55 + 0.20 * sb) * alpha
            const aDiskEdge = (0.20 + 0.38 * sb) * alpha
            const aHaloA    = (0.08 + 0.14 * sb) * alpha
            const aHaloB    = (0.02 + 0.04 * sb) * alpha

            const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, outerR)
            grad.addColorStop(0,    `rgba(255,230,160,${(0.85 * alpha).toFixed(3)})`)
            grad.addColorStop(0.18, `rgba(255,210,120,${aMid.toFixed(3)})`)
            grad.addColorStop(0.36, `rgba(232,180,100,${aDiskEdge.toFixed(3)})`)
            grad.addColorStop(0.55, `rgba(212,160,86,${aHaloA.toFixed(3)})`)
            grad.addColorStop(0.80, `rgba(212,160,86,${aHaloB.toFixed(3)})`)
            grad.addColorStop(1,    'rgba(212,160,86,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(tx, ty, outerR, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      // ── 5. Particles ──────────────────────────────────────────────────────
      if (startedRef.current) {
        if (touchActiveRef.current && now - lastTouchTimeRef.current > 80) {
          fingerSpeedRef.current   *= 0.85
          childPathRateRef.current *= 0.85
        }

        if (touchActiveRef.current) {
          particleFrameRef.current++
          const moving       = fingerSpeedRef.current > 0.08
          const emitInterval = moving ? 2 : 4
          if (particleFrameRef.current % emitInterval === 0) {
            emitParticle(lastTouchRef.current.x, lastTouchRef.current.y, moving, lw)
          }
        }

        if (particlesRef.current.length > 0) {
          updateAndDrawParticles(ctx, lw, dt)
        }
      }

      // ── 6. Breathing label — curved along the active arc ─────────────────
      {
        const fontPx = Math.max(13, Math.min(22, lw * 0.62))
        const prev   = labelPrevRef.current
        if (prev) {
          const t = (now - prev.start) / LABEL_FADE_MS
          if (t >= 1) {
            labelPrevRef.current = null
          } else {
            drawArcLabel(ctx, geo, prev.arc, prev.text, LABEL_ALPHA * (1 - smoothstep(t)), fontPx)
          }
        }
        const cur   = labelRef.current
        const inT   = prev ? smoothstep(Math.min(1, (now - prev.start) / LABEL_FADE_MS)) : 1
        drawArcLabel(ctx, geo, cur.arc, cur.text, LABEL_ALPHA * inT, fontPx)
      }

      // ── 7. Pacing circle — on the overlay canvas above the saturate wrapper.
      {
        const target = gaugeActiveRef.current ? 1 : 0
        const k = 1 - Math.exp(-dt / 400)
        pacingEmphasisRef.current += (target - pacingEmphasisRef.current) * k
      }

      const pacingCanvas = pacingCanvasRef?.current
      const pacingCtx = pacingCanvas?.getContext('2d')
      if (pacingCtx) {
        pacingCtx.save()
        pacingCtx.setTransform(1, 0, 0, 1, 0, 0)
        pacingCtx.clearRect(0, 0, pacingCanvas.width, pacingCanvas.height)
        pacingCtx.scale(dpr, dpr)

        if (pacingPos) {
          const emph  = pacingEmphasisRef.current
          const baseR = lw * 0.62
          // Gentle swell while holding in a cloud — a visual "rest" cue.
          const holdPulse = isHold ? 1 + 0.05 * Math.sin(now / 450) : 1
          const r = baseR * holdPulse * (1 + 0.2 * emph) * (1 + 0.5 * synStage23)

          if (emph > 0.01) {
            const glowR = r * 1.5
            const glow  = pacingCtx.createRadialGradient(
              pacingPos.x, pacingPos.y, r * 0.5,
              pacingPos.x, pacingPos.y, glowR,
            )
            glow.addColorStop(0, `rgba(255,200,130,${(0.45 * emph).toFixed(3)})`)
            glow.addColorStop(1, 'rgba(255,200,130,0)')
            pacingCtx.beginPath()
            pacingCtx.arc(pacingPos.x, pacingPos.y, glowR, 0, Math.PI * 2)
            pacingCtx.fillStyle = glow
            pacingCtx.fill()
          }

          const fillAlpha = 0.55 + 0.30 * emph
          const fillR = Math.round(255 - 43 * synStage12)
          const fillG = Math.round(255 - 95 * synStage12)
          const fillB = Math.round(255 - 169 * synStage12)
          pacingCtx.beginPath()
          pacingCtx.arc(pacingPos.x, pacingPos.y, r, 0, Math.PI * 2)
          pacingCtx.fillStyle = `rgba(${fillR},${fillG},${fillB},${fillAlpha.toFixed(3)})`
          pacingCtx.fill()
          // Thin warm ring so the white circle stays visible resting on the
          // white clouds (the other games never park it on a light surface).
          pacingCtx.lineWidth   = 2
          pacingCtx.strokeStyle = 'rgba(212,160,86,0.55)'
          pacingCtx.stroke()
        }

        // Ember particles (Stage 3→4)
        if (pacingPos && synStage34 > 0) {
          const spawnInterval = 1000 / (EMBER_SPAWN_RATE_AT_FULL * synStage34)
          if (now - lastEmberSpawnRef.current > spawnInterval) {
            const particles = emberParticlesRef.current
            let slot = particles.find(p => p.life <= 0)
            if (!slot && particles.length < EMBER_PARTICLE_CAP) {
              slot = {}
              particles.push(slot)
            }
            if (slot) {
              const angle = Math.random() * Math.PI * 2
              const speed = 0.05 + Math.random() * 0.02
              slot.x       = pacingPos.x + (Math.random() - 0.5) * lw * 0.2
              slot.y       = pacingPos.y + (Math.random() - 0.5) * lw * 0.2
              slot.vx      = Math.cos(angle) * speed
              slot.vy      = Math.sin(angle) * speed
              slot.maxLife = 1000 + Math.random() * 400
              slot.life    = slot.maxLife
            }
            lastEmberSpawnRef.current = now
          }
        }

        for (const p of emberParticlesRef.current) {
          if (p.life <= 0) continue
          p.life -= dt
          if (p.life <= 0) continue
          p.x += p.vx * dt
          p.y += p.vy * dt

          const lifeT = p.life / p.maxLife
          const r     = lw * 0.20 * Math.sqrt(lifeT)
          const alpha = lifeT * 0.70
          if (r < 0.5 || alpha < 0.02) continue

          const grad = pacingCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
          grad.addColorStop(0, `rgba(255,210,130,${alpha.toFixed(3)})`)
          grad.addColorStop(1, 'rgba(212,140,60,0)')
          pacingCtx.beginPath()
          pacingCtx.arc(p.x, p.y, r, 0, Math.PI * 2)
          pacingCtx.fillStyle = grad
          pacingCtx.fill()
        }

        pacingCtx.restore()
      }

      // ── 8. Fingerprint indicator (pre-start, at the left-cloud rest) ──────
      if (fpImgReadyRef.current && pacingPos && (fingerprintActiveRef.current || fpDismissingRef.current)) {
        const { x, y } = pacingPos
        const baseR    = lw * 0.45
        const dismissT = fpDismissTRef.current
        const fpR      = baseR * (1 - dismissT)
        const pulse    = 0.85 + 0.15 * Math.sin(now / 1000 * Math.PI)
        const alpha    = pulse * (1 - dismissT)

        if (fpR > 0.5 && alpha > 0.01) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, fpR * 1.6)
          glow.addColorStop(0, `rgba(212,160,86,${(0.22 * (1 - dismissT)).toFixed(3)})`)
          glow.addColorStop(1, 'rgba(212,160,86,0)')
          ctx.beginPath()
          ctx.arc(x, y, fpR * 1.6, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()

          ctx.globalAlpha = alpha
          ctx.drawImage(fpImgRef.current, x - fpR, y - fpR, fpR * 2, fpR * 2)
          ctx.globalAlpha = 1
        }
      }

      // ── 9. Encouragement moment (fires on arc promotion) ─────────────────
      const enc = encouragementRef.current
      if (enc) {
        const t = (now - enc.startTime) / 2_000
        if (t < 1) {
          const alpha = 1 - t
          const holeR = geo.radii[0] - lw / 2
          const encY  = geo.baseY - holeR * 0.45
          const glowR = geo.radii[3] * 0.9
          const grad  = ctx.createRadialGradient(geo.cx, encY, 0, geo.cx, encY, glowR)
          grad.addColorStop(0, `rgba(212,160,86,${(alpha * 0.3).toFixed(3)})`)
          grad.addColorStop(1, 'rgba(212,160,86,0)')
          ctx.beginPath()
          ctx.arc(geo.cx, encY, glowR, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()

          const fs = Math.max(14, Math.min(20, holeR * 0.32))
          ctx.save()
          ctx.font         = `600 ${fs}px 'Nunito', sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.shadowBlur   = 8
          ctx.shadowColor  = 'rgba(255,255,255,0.6)'
          ctx.fillStyle    = `rgba(255,255,255,${(alpha * 0.92).toFixed(3)})`
          ctx.fillText('Beautiful work', geo.cx, encY)
          ctx.restore()
        } else {
          encouragementRef.current = null
        }
      }

      ctx.restore()
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      cancelAnimationFrame(dismissRafRef.current)
      cancelAnimationFrame(bloomFadeRafRef.current)
      cancelAnimationFrame(bloomAttackRafRef.current)
      cancelAnimationFrame(paintPressureRafRef.current)
      ro.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // intentional [] deps — all mutable state lives in refs, all props read via ref

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: interactive ? 'auto' : 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    />
  )
})

export default RainbowCanvas
