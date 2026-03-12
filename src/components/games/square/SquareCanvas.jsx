// ── SquareCanvas.jsx ──────────────────────────────────────────────────────────
// Headless component — renders null. Exposes an imperative API (via forwardRef)
// that orchestrates both taperedStroke and layeredWash stroke modules.
//
// Imperative API (accessed via ref):
//   init({ paintCtx, cssLw, dpr, color, lapColorIdx, clipArgs })
//     — Applies annular clip to the shared paint canvas (for taperedStroke),
//       then initializes both modules. Must be called on mount and after resize.
//   addPoint(x, y, vel)
//     — Delegates to the active module only (determined by strokeModeRef).
//   updateColor(color, lapColorIdx)
//     — Updates color in both modules (called on every pointer move).
//   lift()
//     — Lifts the pen in both modules.
//   clearAll(paintCtx, clipArgs)
//     — Clears both modules. taperedStroke.clear() also wipes the clip, so
//       the clip is reapplied to paintCtx before returning.
//   getWatercolorLayers()
//     — Returns layeredWash.getLayers() for frame-loop compositing.
//
// Props:
//   strokeModeRef  — { current: 'classic' | 'watercolor' }
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle } from 'react'
import * as taperedStroke from './strokes/taperedStroke'
import * as layeredWash   from './strokes/layeredWash'

// Applies a permanent annular clip to a canvas context.
// paintCtx.save() is called but intentionally never restored — the clip
// must persist across all subsequent draw calls.
function applyPaintClip(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()   // NOTE: do not restore — clip must persist
  ctx.beginPath()
  ctx.roundRect(left, top, sqW, sqW, cr)
  ctx.roundRect(
    left + lw,
    top  + lw,
    sqW  - lw * 2,
    sqW  - lw * 2,
    Math.max(0, cr - lw),
  )
  ctx.clip('evenodd')
}

const SquareCanvas = forwardRef(function SquareCanvas({ strokeModeRef }, ref) {

  useImperativeHandle(ref, () => ({

    // ── init ──────────────────────────────────────────────────────────────────
    // clipArgs: { left, top, sqW, cr, lw } — all in physical pixels.
    init({ paintCtx, cssLw, dpr, color, lapColorIdx, clipArgs }) {
      // Apply clip to the shared paint canvas before handing it to taperedStroke.
      applyPaintClip(paintCtx, clipArgs)

      // Initialize both modules, regardless of which is currently active.
      taperedStroke.init({ paintCtx, lw: cssLw, dpr, color, lapColorIdx })
      layeredWash.init({ paintCtx, lw: cssLw, dpr, color, lapColorIdx, clipArgs })
    },

    // ── addPoint ──────────────────────────────────────────────────────────────
    // Delegates to the active module only.
    addPoint(x, y, vel) {
      if (strokeModeRef.current === 'watercolor') {
        layeredWash.addPoint(x, y, vel)
      } else {
        taperedStroke.addPoint(x, y, vel)
      }
    },

    // ── updateColor ───────────────────────────────────────────────────────────
    // Updates both modules so a mode switch never shows stale color.
    updateColor(color, lapColorIdx) {
      taperedStroke.updateColor(color, lapColorIdx)
      layeredWash.updateColor(color, lapColorIdx)
    },

    // ── lift ──────────────────────────────────────────────────────────────────
    // Lifts the pen in both modules.
    lift() {
      taperedStroke.lift()
      layeredWash.lift()
    },

    // ── clearAll ──────────────────────────────────────────────────────────────
    // taperedStroke.clear() wipes the shared paint canvas via width reassignment,
    // which destroys the clip. Reapply immediately after. layeredWash.clear()
    // uses clearRect so its per-layer clips survive intact.
    clearAll(paintCtx, clipArgs) {
      taperedStroke.clear()
      applyPaintClip(paintCtx, clipArgs)
      layeredWash.clear()
    },

    // ── getWatercolorLayers ───────────────────────────────────────────────────
    // Returns { canvas, ctx }[] for back-to-front compositing in the frame loop.
    getWatercolorLayers() {
      return layeredWash.getLayers()
    },

  }), [])

  return null
})

export default SquareCanvas
