// ── stampStroke.js ────────────────────────────────────────────────────────────
// Radial gradient stamp stroke — stamps placed along the track centerline at
// STAMP_SPACING intervals. A stamp is drawn on first touch with no movement
// required. Organic leading edge and rail-edge accumulation darkening. Stamp
// radius scales with curvature to guarantee corner coverage. Draws permanently
// onto an externally-owned offscreen canvas supplied via init(). Clip path
// management stays with the caller.
//
// Exported interface (module-level singleton):
//   init({ paintCtx, lw, dpr, color, lapColorIdx })
//   addPoint(x, y, vel, pressure)
//   updateColor(color, lapColorIdx)
//   lift()
//   clear()
//   COMPOSITE_ALPHA — caller multiplies this into the paint composite globalAlpha
// ─────────────────────────────────────────────────────────────────────────────

// ── Tuning constants ──────────────────────────────────────────────────────────
const STAMP_SPACING     = 0.12  // stamp pitch as fraction of lw (CSS px)
const BODY_OPACITY      = 0.92  // globalAlpha per body stamp
const LEAD_RADIUS_MULT  = 1.10  // leading edge stamp radius multiplier
const LEAD_OFFSET_MULT  = 0.20  // leading edge forward offset as fraction of lw
const LEAD_OPACITY_MULT = 0.30  // leading edge globalAlpha multiplier (× BODY_OPACITY)
const RAIL_OPACITY_MULT = 0.25  // rail accumulation ring globalAlpha
const RAIL_RING_FRAC    = 0.14  // rail ring width as fraction of stamp radius
const CORNER_RADIUS_MAX = 1.24  // max radius multiplier on tight corners
export const COMPOSITE_ALPHA = 0.92  // caller uses for paint canvas composite

// ── Module state ──────────────────────────────────────────────────────────────
let _ctx       = null
let _lw        = 0
let _dpr       = 1
let _cr        = 0     // parsed color — red channel
let _cg        = 0     // parsed color — green channel
let _cb        = 0     // parsed color — blue channel
let _prev      = null  // { x, y } CSS px — null = pen up
let _moveDir   = { x: 1, y: 0 }
let _prevDir   = null
let _curvature = 0     // 0 (straight) → 1 (tight corner), smoothed
let _travel    = 0     // CSS px accumulated since last stamp placed

// ── parseColor ────────────────────────────────────────────────────────────────
// Accepts '#RRGGBB' or 'rgb(r,g,b)' — stores channels into module state.
function parseColor(color) {
  if (color.startsWith('#')) {
    _cr = parseInt(color.slice(1, 3), 16)
    _cg = parseInt(color.slice(3, 5), 16)
    _cb = parseInt(color.slice(5, 7), 16)
  } else {
    const m = color.match(/\d+/g)
    if (m && m.length >= 3) { _cr = +m[0]; _cg = +m[1]; _cb = +m[2] }
  }
}

function rgba(a) {
  return `rgba(${_cr},${_cg},${_cb},${a.toFixed(3)})`
}

// ── _placeBodyStamp ───────────────────────────────────────────────────────────
// Solid-center radial gradient that fills the track width.
function _placeBodyStamp(sx, sy, radiusMult, opacity) {
  const d  = _dpr
  const px = sx * d
  const py = sy * d
  const r  = (_lw / 2) * d * radiusMult

  const grad = _ctx.createRadialGradient(px, py, 0, px, py, r)
  grad.addColorStop(0,    rgba(1))
  grad.addColorStop(0.82, rgba(1))
  grad.addColorStop(1,    rgba(0))

  _ctx.save()
  _ctx.globalAlpha = opacity
  _ctx.fillStyle   = grad
  _ctx.beginPath()
  _ctx.arc(px, py, r, 0, Math.PI * 2)
  _ctx.fill()
  _ctx.restore()
}

// ── _placeRailStamp ───────────────────────────────────────────────────────────
// Semi-transparent ring at the outer edge of the stamp — subtle track-edge
// accumulation darkening that makes the stroke look heavier at the rails.
function _placeRailStamp(sx, sy, opacity) {
  const d      = _dpr
  const px     = sx * d
  const py     = sy * d
  const r      = (_lw / 2) * d
  const ringR0 = r * (1 - RAIL_RING_FRAC * 2)

  const grad = _ctx.createRadialGradient(px, py, ringR0, px, py, r)
  grad.addColorStop(0, rgba(0))
  grad.addColorStop(1, rgba(1))

  _ctx.save()
  _ctx.globalAlpha = opacity
  _ctx.fillStyle   = grad
  _ctx.beginPath()
  _ctx.arc(px, py, r, 0, Math.PI * 2)
  _ctx.fill()
  _ctx.restore()
}

// ── _placeLeadStamp ───────────────────────────────────────────────────────────
// Soft, larger, very transparent stamp ahead of current position — creates an
// organic "wet paint" leading edge with a slight forward reach.
function _placeLeadStamp(x, y, pressure) {
  const lx = x + _moveDir.x * _lw * LEAD_OFFSET_MULT
  const ly = y + _moveDir.y * _lw * LEAD_OFFSET_MULT
  const d  = _dpr
  const px = lx * d
  const py = ly * d
  const r  = (_lw / 2) * d * LEAD_RADIUS_MULT

  const grad = _ctx.createRadialGradient(px, py, 0, px, py, r)
  grad.addColorStop(0,   rgba(1))
  grad.addColorStop(0.5, rgba(0.8))
  grad.addColorStop(1,   rgba(0))

  _ctx.save()
  _ctx.globalAlpha = BODY_OPACITY * LEAD_OPACITY_MULT * pressure
  _ctx.fillStyle   = grad
  _ctx.beginPath()
  _ctx.arc(px, py, r, 0, Math.PI * 2)
  _ctx.fill()
  _ctx.restore()
}

// ── init ──────────────────────────────────────────────────────────────────────
// Called once on mount and again whenever geometry changes (resize).
export function init({ paintCtx, lw, dpr, color }) {
  _ctx       = paintCtx
  _lw        = lw
  _dpr       = dpr
  _prev      = null
  _travel    = 0
  _curvature = 0
  _prevDir   = null
  _moveDir   = { x: 1, y: 0 }
  parseColor(color)
}

// ── addPoint ──────────────────────────────────────────────────────────────────
// x, y: centerline position in CSS px.
// pressure (0→1): opacity ramp-in on each new touch — scales stamp globalAlpha.
export function addPoint(x, y, _vel, pressure = 1) {
  if (!_ctx) return

  if (_prev === null) {
    // First touch — place one body + rail stamp immediately, no movement needed.
    _prev      = { x, y }
    _travel    = 0
    _curvature = 0
    _placeBodyStamp(x, y, 1, BODY_OPACITY * pressure)
    _placeRailStamp(x, y, RAIL_OPACITY_MULT * pressure)
    return
  }

  const dx   = x - _prev.x
  const dy   = y - _prev.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.1) { _prev = { x, y }; return }

  const newDir = { x: dx / dist, y: dy / dist }

  // Curvature: smooth angle change between consecutive movement directions.
  if (_prevDir) {
    const dot   = Math.max(-1, Math.min(1, _prevDir.x * newDir.x + _prevDir.y * newDir.y))
    const angle = Math.acos(dot)                      // 0 = straight
    const raw   = Math.min(1, angle / (Math.PI / 4)) // 1 at 45° turn
    _curvature  = _curvature * 0.7 + raw * 0.3       // smooth
  }
  _prevDir = _moveDir
  _moveDir = newDir

  _travel += dist
  const spacing     = _lw * STAMP_SPACING
  const cornerScale = 1 + _curvature * (CORNER_RADIUS_MAX - 1)

  while (_travel >= spacing) {
    _travel -= spacing
    const sx = x - _moveDir.x * _travel
    const sy = y - _moveDir.y * _travel
    _placeBodyStamp(sx, sy, cornerScale, BODY_OPACITY * pressure)
    _placeRailStamp(sx, sy, RAIL_OPACITY_MULT * pressure)
  }

  // Organic leading edge — redrawn every pointer event at current position.
  _placeLeadStamp(x, y, pressure)

  _prev = { x, y }
}

// ── updateColor ───────────────────────────────────────────────────────────────
// Called whenever the active stroke color changes (lap boundary or intra-lap
// interpolation). All subsequent stamp draws will use this color.
export function updateColor(color, _lapColorIdx) {
  parseColor(color)
}

// ── lift ──────────────────────────────────────────────────────────────────────
// Called on pointer up. Resets pen position so the next touch starts fresh.
export function lift() {
  _prev      = null
  _travel    = 0
  _curvature = 0
  _prevDir   = null
}

// ── clear ─────────────────────────────────────────────────────────────────────
// Clears the paint canvas and resets pen state. Called by heat gauge floor.
export function clear() {
  if (_ctx) {
    const cv = _ctx.canvas
    cv.width = cv.width
  }
  _prev      = null
  _travel    = 0
  _curvature = 0
  _prevDir   = null
}
