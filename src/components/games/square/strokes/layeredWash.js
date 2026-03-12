// ── layeredWash.js ────────────────────────────────────────────────────────────
// Watercolor-effect stroke — LAYER_COUNT offscreen canvases composited back-
// to-front. Each layer accumulates paint with per-layer position jitter, width,
// and alpha. Velocity EMA drives opacity and stroke weight. Catmull-Rom spline
// smoothing for organic curves.
//
// These canvases are separate from the shared taperedStroke paint canvas.
// The annular clip is applied to each layer canvas internally on init().
// clear() uses clearRect (NOT canvas.width reassignment) so the clip persists.
//
// Exported interface (module-level singleton):
//   init(config)
//   addPoint(x, y, vel)
//   updateColor(color, lapColorIdx)
//   lift()
//   clear()
//   getLayers()  →  { canvas, ctx, points }[]
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tuning constants ─────────────────────────────────────────────────────────
// Edit these values to adjust the watercolor stroke appearance.
// See BRIEFING.md Section 6.4 Visual Polish — 1b for full documentation.

// Layers
const LAYER_COUNT     = 5
const WIDTH_SPREAD    = 2.0
const INNER_WIDTH     = 0.5
const OUTER_ALPHA     = 0.02
const INNER_ALPHA     = 0.3
const EDGE_JITTER     = 2.0

// Stroke body
const BASE_WIDTH      = 40
const MIN_WIDTH_FRAC  = 0.3
const GLOBAL_OPACITY  = 0.3
const SUBDIV_MAX      = 20   // reserved for future adaptive subdivision

// Velocity response
const VEL_ENABLED     = true
const VEL_SENSITIVITY = 12
const OPACITY_MIN     = 0.35
const OPACITY_MAX     = 0.5

// Wet edge
const WET_EDGE        = true
const WET_EDGE_WIDTH  = 0.3
const WET_EDGE_STR    = 1.0

// Texture grain
const TEX_GRAIN       = false
const GRAIN_PASSES    = 4
const GRAIN_OPACITY   = 0.06
const GRAIN_SCATTER   = 0.70

// ── Module-level state ────────────────────────────────────────────────────────
let layers        = []         // { canvas, ctx, points }[]
let velEma        = 0
let currentColor  = '#7DB89A'
let currentLapIdx = 0
let _dpr          = 1          // device pixel ratio — used to scale CSS px → physical px

// ── Helpers ───────────────────────────────────────────────────────────────────

// Converts a hex color string to an [r, g, b] integer array.
export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// Catmull-Rom control points for the p1→p2 segment.
// p0 and p3 are the flanking points used for tangent computation.
// tension=0.4 gives a moderately tight spline.
function catmullCP(p0, p1, p2, p3, tension = 0.4) {
  return {
    cp1: {
      x: p1.x + (p2.x - p0.x) * tension / 3,
      y: p1.y + (p2.y - p0.y) * tension / 3,
    },
    cp2: {
      x: p2.x - (p3.x - p1.x) * tension / 3,
      y: p2.y - (p3.y - p1.y) * tension / 3,
    },
  }
}

// Draws a thin overdraw along the same bezier path, simulating pigment
// buildup at the stroke edge. Only called on outer-half layers.
// All coordinates and widths are in physical pixels.
function drawWetEdge(lCtx, p1, p2, cp1, cp2, layerW, layerAlpha) {
  const hw        = layerW / 2
  const edgeW     = hw * WET_EDGE_WIDTH
  const edgeAlpha = layerAlpha * WET_EDGE_STR * 2.2

  lCtx.save()
  lCtx.globalAlpha = edgeAlpha
  lCtx.strokeStyle = currentColor
  lCtx.lineWidth   = edgeW
  lCtx.lineCap     = 'round'
  lCtx.beginPath()
  lCtx.moveTo(p1.x, p1.y)
  lCtx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y)
  lCtx.stroke()
  lCtx.restore()
}

// Scatters small ellipses near the segment to simulate paper texture grain.
// Only active when TEX_GRAIN is true. Applied to inner-half layers.
// All coordinates and widths are in physical pixels.
function drawGrain(lCtx, p1, p2, layerW, layerAlpha) {
  const hw        = layerW / 2
  const [r, g, b] = hexToRgb(currentColor)

  for (let p = 0; p < GRAIN_PASSES; p++) {
    const t      = Math.random()
    const gx     = p1.x + (p2.x - p1.x) * t
    const gy     = p1.y + (p2.y - p1.y) * t
    const radial = hw * (GRAIN_SCATTER * 0.5 + Math.random() * GRAIN_SCATTER * 0.5)
    const angle  = Math.random() * Math.PI * 2
    const ex     = gx + Math.cos(angle) * radial
    const ey     = gy + Math.sin(angle) * radial
    const ew     = 1 + Math.random() * 2
    const eh     = 0.5 + Math.random() * 1.5

    lCtx.save()
    lCtx.globalAlpha = GRAIN_OPACITY
    lCtx.fillStyle   = `rgb(${r},${g},${b})`
    lCtx.translate(ex, ey)
    lCtx.rotate(Math.random() * Math.PI)
    lCtx.beginPath()
    lCtx.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2)
    lCtx.fill()
    lCtx.restore()
  }
}

// ── init ─────────────────────────────────────────────────────────────────────
// Creates LAYER_COUNT offscreen canvases sized to match paintCtx.canvas
// (physical pixels), applies the annular clip to each, and resets all state.
// clipArgs: { left, top, sqW, cr, lw } — all in physical pixels.
export function init({ paintCtx, lw, dpr, color, lapColorIdx, clipArgs }) {
  _dpr          = dpr ?? 1
  currentColor  = color ?? currentColor
  currentLapIdx = lapColorIdx ?? 0
  velEma        = 0

  const W = paintCtx.canvas.width    // physical px
  const H = paintCtx.canvas.height   // physical px

  layers = Array.from({ length: LAYER_COUNT }, () => {
    const cv   = document.createElement('canvas')
    cv.width   = W
    cv.height  = H
    const lCtx = cv.getContext('2d')

    if (clipArgs) {
      lCtx.save()   // NOTE: intentionally not restored — clip must persist
      lCtx.beginPath()
      lCtx.roundRect(clipArgs.left, clipArgs.top, clipArgs.sqW, clipArgs.sqW, clipArgs.cr)
      lCtx.roundRect(
        clipArgs.left + clipArgs.lw,
        clipArgs.top  + clipArgs.lw,
        clipArgs.sqW  - clipArgs.lw * 2,
        clipArgs.sqW  - clipArgs.lw * 2,
        Math.max(0, clipArgs.cr - clipArgs.lw),
      )
      lCtx.clip('evenodd')
    }

    return { canvas: cv, ctx: lCtx, points: [] }
  })
}

// ── addPoint ─────────────────────────────────────────────────────────────────
// x, y in CSS px; vel in CSS px/ms.
// Per-layer jitter is applied to position before storing in points[].
// Drawing uses the last 4 buffered points for Catmull-Rom smoothing.
// All canvas drawing is in physical pixels (_dpr scaling applied here).
export function addPoint(x, y, vel) {
  if (!layers.length) return

  // 1. Update velocity EMA — slower speed → wider, more opaque strokes.
  velEma = velEma * 0.8 + vel * 0.2

  // 2. Opacity multiplier from velocity.
  let velAlphaMult
  if (VEL_ENABLED) {
    const normVel = Math.min(1, velEma / (VEL_SENSITIVITY * 3))
    velAlphaMult = (OPACITY_MAX - normVel * (OPACITY_MAX - OPACITY_MIN)) * GLOBAL_OPACITY
  } else {
    velAlphaMult = OPACITY_MAX * GLOBAL_OPACITY
  }

  // 3. Stroke width in CSS px — velocity thins it at speed.
  let strokeW
  if (VEL_ENABLED) {
    const normVel = Math.min(1, velEma / (VEL_SENSITIVITY * 3))
    strokeW = BASE_WIDTH * (MIN_WIDTH_FRAC + (1 - MIN_WIDTH_FRAC) * (1 - normVel))
  } else {
    strokeW = BASE_WIDTH
  }

  const d = _dpr

  // 4. Draw each layer (0 = outermost/widest, LAYER_COUNT-1 = innermost/narrowest).
  for (let i = 0; i < LAYER_COUNT; i++) {
    const layer = layers[i]
    const t     = i / (LAYER_COUNT - 1)   // 0.0 at outer, 1.0 at inner

    const wMult  = WIDTH_SPREAD - t * (WIDTH_SPREAD - INNER_WIDTH)
    const layerW = strokeW * wMult   // CSS px width for this layer

    const layerAlpha = (OUTER_ALPHA + t * (INNER_ALPHA - OUTER_ALPHA)) * velAlphaMult

    // Outer layers get full jitter; inner layers get none — sharpens center.
    const jScale = 1 - t
    const jx     = (Math.random() * 2 - 1) * EDGE_JITTER * jScale
    const jy     = (Math.random() * 2 - 1) * EDGE_JITTER * jScale

    layer.points.push({ x: x + jx, y: y + jy })

    if (layer.points.length < 2) continue

    // Scale the last up-to-4 points to physical pixels for drawing.
    const pts = layer.points
    const len = pts.length

    let p1, p2, cp1, cp2
    if (len >= 4) {
      // Full Catmull-Rom: use 4 buffered points.
      // Drawn segment is pts[len-3] → pts[len-2]; pts[len-4] and pts[len-1]
      // provide the tangent context — no extrapolation needed.
      const P0 = { x: pts[len - 4].x * d, y: pts[len - 4].y * d }
      const P1 = { x: pts[len - 3].x * d, y: pts[len - 3].y * d }
      const P2 = { x: pts[len - 2].x * d, y: pts[len - 2].y * d }
      const P3 = { x: pts[len - 1].x * d, y: pts[len - 1].y * d }
      const cps = catmullCP(P0, P1, P2, P3)
      p1 = P1; p2 = P2; cp1 = cps.cp1; cp2 = cps.cp2
    } else {
      // Fallback: straight line from second-to-last → last point.
      p1  = { x: pts[len - 2].x * d, y: pts[len - 2].y * d }
      p2  = { x: pts[len - 1].x * d, y: pts[len - 1].y * d }
      cp1 = p1
      cp2 = p2
    }

    const physW = layerW * d   // physical px lineWidth

    layer.ctx.save()
    layer.ctx.globalAlpha = layerAlpha
    layer.ctx.strokeStyle = currentColor
    layer.ctx.lineWidth   = physW
    layer.ctx.lineCap     = 'round'
    layer.ctx.lineJoin    = 'round'
    layer.ctx.beginPath()
    layer.ctx.moveTo(p1.x, p1.y)
    layer.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y)
    layer.ctx.stroke()
    layer.ctx.restore()

    // Wet-edge overdraw on outer-half layers (i < LAYER_COUNT/2).
    if (WET_EDGE && i < LAYER_COUNT / 2) {
      drawWetEdge(layer.ctx, p1, p2, cp1, cp2, physW, layerAlpha)
    }

    // Texture grain on inner-half layers (i >= LAYER_COUNT/2).
    if (TEX_GRAIN && i >= LAYER_COUNT / 2) {
      drawGrain(layer.ctx, p1, p2, physW, layerAlpha)
    }
  }
}

// ── updateColor ───────────────────────────────────────────────────────────────
export function updateColor(color, lapColorIdx) {
  currentColor  = color
  currentLapIdx = lapColorIdx ?? currentLapIdx
}

// ── lift ──────────────────────────────────────────────────────────────────────
// Called on pointer up. Resets each layer's point buffer so the next
// touch-down starts a fresh Catmull-Rom chain rather than connecting back
// to the previous stroke.
export function lift() {
  for (const layer of layers) {
    layer.points = []
  }
}

// ── clear ─────────────────────────────────────────────────────────────────────
// Wipes all painted content via clearRect and empties all point buffers.
// The annular clip on each layer canvas is preserved — clearRect does not
// reset a clip that was applied with save() that was never restored.
export function clear() {
  for (const layer of layers) {
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    layer.points = []
  }
  velEma = 0
}

// ── getLayers ────────────────────────────────────────────────────────────────
// Returns the layer array for back-to-front compositing in the frame loop.
// Caller draws each layer.canvas with drawImage, outermost (index 0) first.
export function getLayers() {
  return layers
}
