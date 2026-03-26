// ── taperedStroke.js ──────────────────────────────────────────────────────────
// Classic solid stroke — lineTo from prev to current, full track width, round
// lineCap, interpolated lap color. Draws permanently onto an externally-owned
// offscreen canvas supplied via init(). Clip path management stays with the
// caller; this module does not apply or remove clip paths.
//
// Exported interface (module-level singleton):
//   init({ paintCtx, lw, dpr, color, lapColorIdx })
//   addPoint(x, y, vel)
//   updateColor(color, lapColorIdx)
//   lift()
//   clear()
// ─────────────────────────────────────────────────────────────────────────────

let _ctx         = null   // CanvasRenderingContext2D of the offscreen paint canvas
let _lw          = 0      // track width in CSS px
let _dpr         = 1      // device pixel ratio
let _color       = '#000' // current stroke color (CSS string)
let _prev        = null   // { x, y } previous point in CSS px, null = pen up
let _strokeScale = 1      // 0→1 multiplier applied to line width — set by heat gauge each frame

// ── init ─────────────────────────────────────────────────────────────────────
// Called once on mount and again whenever geometry changes (resize).
// Stores references. Resets the pen position. Does NOT apply the clip path.
export function init({ paintCtx, lw, dpr, color, lapColorIdx }) {
  _ctx   = paintCtx
  _lw    = lw
  _dpr   = dpr
  _color = color
  _prev  = null
}

// ── addPoint ─────────────────────────────────────────────────────────────────
// Called on every pointer move with the projected, clamped position and the
// current velocity (CSS px/ms). Velocity is accepted for interface parity with
// layeredWash but is not used by this module.
// The first call after init/lift/clear stores the anchor without drawing.
// pressure (0→1): scales globalAlpha only — opacity ramp-in on each new touch.
// jitter  (0→1): per-point opacity multiplier — used for organic variation.
export function addPoint(x, y, _vel, pressure = 1, jitter = 1) {
  if (!_ctx) return
  if (_prev === null) {
    _prev = { x, y }
    return
  }
  const d = _dpr
  const strokeWidth = _lw * d * _strokeScale
  if (strokeWidth < 0.5) { _prev = { x, y }; return }
  _ctx.save()
  _ctx.beginPath()
  _ctx.moveTo(_prev.x * d, _prev.y * d)
  _ctx.lineTo(x * d, y * d)
  _ctx.strokeStyle = _color
  _ctx.lineWidth   = strokeWidth
  _ctx.globalAlpha = pressure * jitter
  _ctx.lineCap     = 'round'
  _ctx.stroke()
  _ctx.restore()
  _prev = { x, y }
}

// ── setStrokeScale ────────────────────────────────────────────────────────────
// Called once per frame by the heat gauge system. All subsequent addPoint calls
// use this scale until it is updated again. 1 = full width, 0 = no stroke.
export function setStrokeScale(scale) {
  _strokeScale = scale
}

// ── updateColor ───────────────────────────────────────────────────────────────
// Called whenever the active stroke color changes — either at a lap boundary
// or for continuous intra-lap interpolation. All subsequent addPoint calls
// will use this color until updateColor is called again.
export function updateColor(color, _lapColorIdx) {
  _color = color
}

// ── lift ─────────────────────────────────────────────────────────────────────
// Called on pointer up. Resets the internal anchor so the next touch down
// starts a fresh segment rather than bridging back to the old position.
export function lift() {
  _prev = null
}

// ── clear ─────────────────────────────────────────────────────────────────────
// Called on game reset. Clears all painted content on the paint canvas by
// resetting its width (which also wipes all context state including any clip
// path). Does NOT reapply the clip — the caller must do that immediately after.
// Resets the internal pen position.
export function clear() {
  if (_ctx) {
    const cv = _ctx.canvas
    cv.width = cv.width   // clears content + resets all context state
  }
  _prev = null
}
