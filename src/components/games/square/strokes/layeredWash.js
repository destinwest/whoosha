// ── layeredWash.js ────────────────────────────────────────────────────────────
// Watercolor-effect stroke — LAYER_COUNT offscreen canvases composited back-
// to-front. Each layer has jitter in width and opacity. Velocity EMA drives
// stroke weight. Catmull-Rom spline smoothing for organic curves. Wet-edge
// overdraw on outer layers simulates pigment buildup at stroke edges.
//
// These canvases are separate from the shared taperedStroke paint canvas.
// The annular clip is applied to each layer canvas internally on init().
// clear() uses clearRect (NOT canvas.width reassignment) so the clip persists.
//
// Exported interface (module-level singleton):
//   init({ paintCtx, lw, dpr, color, lapColorIdx, clipArgs })
//   addPoint(x, y, vel)
//   updateColor(color, lapColorIdx)
//   lift()
//   clear()
//   getLayers()  →  { canvas, ctx }[]
// ─────────────────────────────────────────────────────────────────────────────

// ── Named constants ───────────────────────────────────────────────────────────
const LAYER_COUNT     = 5       // number of offscreen layer canvases
const WIDTH_SPREAD    = 2.0     // outer layer width multiplier: inner=1x, outer=(1+SPREAD)x
const BASE_ALPHA      = 0.18    // base per-stroke opacity for each layer
const VEL_ALPHA_RANGE = 0.22    // additional alpha contributed at slow velocity
const VEL_EMA_K       = 0.2     // EMA smoothing factor for velocity
const VEL_SCALE       = 0.12    // CSS px/ms considered "fast" for normalization
const WET_EDGE_ALPHA  = 0.55    // wet edge overdraw opacity multiplier
const WET_EDGE_WIDTH  = 0.45    // wet edge width as fraction of layer stroke width
const TEX_GRAIN       = false   // texture grain pass (disabled by default)
const TENSION         = 0.4     // Catmull-Rom tension coefficient
const SUBDIV_MAX      = 20      // max bezier subdivisions per Catmull-Rom segment (reserved)

// ── Module-level state ────────────────────────────────────────────────────────
let layers  = []    // { canvas, ctx }[]
let velEma  = 0
let _color  = '#000'
let _lapIdx = 0
let _lw     = 0     // CSS px track width
let _dpr    = 1     // device pixel ratio
let _prev   = null  // { x, y } previous point in CSS px — null = pen up
let _pprev  = null  // { x, y } point before prev — used for C-R tangent

// ── Helpers ───────────────────────────────────────────────────────────────────

// Converts a hex color string to an [r, g, b] array.
export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// Returns the two Bezier control points for a Catmull-Rom segment from p1→p2.
// p0 and p3 are the flanking points used to compute the tangent at p1 and p2.
// All points are in physical pixels.
function catmullCP(p0, p1, p2, p3, t = TENSION) {
  return {
    cp1: {
      x: p1.x + (p2.x - p0.x) * t / 3,
      y: p1.y + (p2.y - p0.y) * t / 3,
    },
    cp2: {
      x: p2.x - (p3.x - p1.x) * t / 3,
      y: p2.y - (p3.y - p1.y) * t / 3,
    },
  }
}

// Draws a thin high-alpha overdraw along the same bezier path, simulating
// pigment buildup at the stroke edge. Called only on outer-half layers.
function drawWetEdge(lCtx, p1, p2, cp1, cp2, layerW, layerAlpha) {
  lCtx.save()
  lCtx.strokeStyle = _color
  lCtx.lineWidth   = layerW * WET_EDGE_WIDTH
  lCtx.globalAlpha = layerAlpha * WET_EDGE_ALPHA
  lCtx.lineCap     = 'round'
  lCtx.beginPath()
  lCtx.moveTo(p1.x, p1.y)
  lCtx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y)
  lCtx.stroke()
  lCtx.restore()
}

// Scatters small ellipses along the segment to simulate paper texture grain.
// Only active when TEX_GRAIN is true. Applied to inner-half layers.
function drawGrain(lCtx, p1, p2, layerW, layerAlpha) {
  if (!TEX_GRAIN) return
  const dist  = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const steps = Math.max(2, Math.floor(dist / (layerW * 0.5)))
  lCtx.save()
  lCtx.fillStyle  = _color
  lCtx.globalAlpha = layerAlpha * 0.35
  for (let i = 0; i < steps; i++) {
    const t  = i / steps
    const gx = p1.x + (p2.x - p1.x) * t + (Math.random() - 0.5) * layerW * 0.8
    const gy = p1.y + (p2.y - p1.y) * t + (Math.random() - 0.5) * layerW * 0.4
    lCtx.beginPath()
    lCtx.ellipse(gx, gy, layerW * 0.18, layerW * 0.08, Math.random() * Math.PI, 0, Math.PI * 2)
    lCtx.fill()
  }
  lCtx.restore()
}

// ── init ─────────────────────────────────────────────────────────────────────
// Creates LAYER_COUNT offscreen canvases sized to match paintCtx.canvas,
// applies the annular clip to each, and resets module state.
// clipArgs: { left, top, sqW, cr, lw } — all in physical pixels.
// Does NOT use paintCtx for drawing; only uses its canvas dimensions.
export function init({ paintCtx, lw, dpr, color, lapColorIdx, clipArgs }) {
  _lw     = lw
  _dpr    = dpr
  _color  = color
  _lapIdx = lapColorIdx ?? 0
  _prev   = null
  _pprev  = null
  velEma  = 0

  const W = paintCtx.canvas.width
  const H = paintCtx.canvas.height

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

    return { canvas: cv, ctx: lCtx }
  })
}

// ── addPoint ─────────────────────────────────────────────────────────────────
// x, y in CSS px; vel in CSS px/ms.
// First call after init/lift stores the anchor without drawing.
// Subsequent calls draw a Catmull-Rom bezier segment from _prev → current.
export function addPoint(x, y, vel) {
  if (!layers.length) return

  // Update velocity EMA — slower speed → more opaque strokes.
  velEma = velEma * (1 - VEL_EMA_K) + vel * VEL_EMA_K
  const velNorm      = Math.min(1, velEma / VEL_SCALE)
  const velAlphaMult = 1 + VEL_ALPHA_RANGE * (1 - velNorm)

  if (_prev === null) {
    _prev  = { x, y }
    _pprev = { x, y }
    return
  }

  // Catmull-Rom control points (working in CSS px, scale later).
  const p0 = _pprev
  const p1 = _prev
  const p2 = { x, y }
  // Lookahead extrapolated from p1→p2 direction.
  const p3 = { x: x + (x - p1.x), y: y + (y - p1.y) }

  // Scale to physical pixels for drawing.
  const d  = _dpr
  const P0 = { x: p0.x * d, y: p0.y * d }
  const P1 = { x: p1.x * d, y: p1.y * d }
  const P2 = { x: p2.x * d, y: p2.y * d }
  const P3 = { x: p3.x * d, y: p3.y * d }

  const { cp1, cp2 } = catmullCP(P0, P1, P2, P3)

  const baseStrokeW = _lw * d

  for (let li = 0; li < LAYER_COUNT; li++) {
    const { ctx: lCtx } = layers[li]

    // Inner layers (li=0): narrowest, most opaque.
    // Outer layers (li=LAYER_COUNT-1): widest, most transparent.
    const t          = li / (LAYER_COUNT - 1)
    const strokeW    = baseStrokeW * (1 + WIDTH_SPREAD * t)
    const layerAlpha = BASE_ALPHA * velAlphaMult * (1 - t * 0.4)

    lCtx.save()
    lCtx.strokeStyle = _color
    lCtx.lineWidth   = strokeW
    lCtx.globalAlpha = layerAlpha
    lCtx.lineCap     = 'round'
    lCtx.lineJoin    = 'round'
    lCtx.beginPath()
    lCtx.moveTo(P1.x, P1.y)
    lCtx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, P2.x, P2.y)
    lCtx.stroke()
    lCtx.restore()

    // Wet edge on outer half of layers only.
    if (li >= Math.floor(LAYER_COUNT / 2)) {
      drawWetEdge(lCtx, P1, P2, cp1, cp2, strokeW, layerAlpha)
    }

    // Texture grain on inner half of layers only.
    if (li < Math.floor(LAYER_COUNT / 2)) {
      drawGrain(lCtx, P1, P2, strokeW, layerAlpha)
    }
  }

  _pprev = _prev
  _prev  = { x, y }
}

// ── updateColor ───────────────────────────────────────────────────────────────
export function updateColor(color, lapColorIdx) {
  _color  = color
  _lapIdx = lapColorIdx ?? _lapIdx
}

// ── lift ─────────────────────────────────────────────────────────────────────
// Resets the pen anchor so the next touch-down starts a fresh segment.
export function lift() {
  _prev  = null
  _pprev = null
}

// ── clear ─────────────────────────────────────────────────────────────────────
// Wipes all painted content via clearRect. Does NOT use canvas.width reassignment
// because the clip was applied with save() that is never restored — clearRect
// preserves the existing clip path. Resets the pen position and velocity EMA.
export function clear() {
  for (const { ctx, canvas } of layers) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  _prev  = null
  _pprev = null
  velEma = 0
}

// ── getLayers ────────────────────────────────────────────────────────────────
// Returns the array of { canvas, ctx } objects for compositing in the frame loop.
// Caller should drawImage each canvas back-to-front (index 0 first).
export function getLayers() {
  return layers
}
