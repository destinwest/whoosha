import { useEffect, useRef } from 'react'
import { bboxOf, fitWithMargin, fitCenter, SHAPE_VISUAL_WEIGHT } from '../_shared/cardLayout'

// ── HeartCardPreview ──────────────────────────────────────────────────────────
// The Heart counterpart to Triangle/Hexagon CardPreview: a soft, muted render
// of the Heart game for the home carousel card. A calm "resting" state — a
// simple two-stop salmon gradient (no ridges/scenery, matching the game's own
// radial salmon field but as a flat linear stop for the card, same treatment
// as Triangle/HexagonCardPreview) with the cream heart track in its bare base
// colour, and a quiet pale pacing dot at the cleft (the start of the
// breathe-in half). No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — same unit heart shape and track-width
// coefficient — so the card reads as the real heart track, just softened and
// quiet. Size/position come from the shared cardLayout module: this file's
// own unit heart vertices (S=1) bounding box drives both the fit and the
// vertical centering, no manual offset needed.

const TRACK_COLOR = '#F7EBD9'   // the game track's base cream (drawTrackBody base stop)

// Unit-space heart anchor points (S=1) — same proportions as HeartCanvas's
// HEART_UNIT_SEGS (bbox half-width 36, half-height 38, centered at origin).
// Duplicated locally (not imported) per this codebase's CardPreview
// convention — see TriangleCardPreview's own local buildVerts. Cleft/tip
// rounding radii kept in sync with HeartCanvas's CLEFT_ROUND/TIP_ROUND —
// see that file's comment for why a nonzero shared tangent rounds a joint.
const CLEFT_ROUND = 7
const TIP_ROUND    = 15
const HEART_UNIT_SEGS = [
  { p0: { x: 0,   y: -30 }, c1: { x: -CLEFT_ROUND, y: -30 }, c2: { x: -6,  y: -38 }, p1: { x: -12, y: -38 } },
  { p0: { x: -12, y: -38 }, c1: { x: -24, y: -38 }, c2: { x: -36, y: -30 }, p1: { x: -36, y: -14 } },
  { p0: { x: -36, y: -14 }, c1: { x: -36, y: 12  }, c2: { x: -TIP_ROUND, y: 38 }, p1: { x: 0,   y: 38  } },
  { p0: { x: 0,   y: 38  }, c1: { x: TIP_ROUND, y: 38 }, c2: { x: 36,  y: 12  }, p1: { x: 36,  y: -14 } },
  { p0: { x: 36,  y: -14 }, c1: { x: 36,  y: -30 }, c2: { x: 24,  y: -38 }, p1: { x: 12,  y: -38 } },
  { p0: { x: 12,  y: -38 }, c1: { x: 6,   y: -38 }, c2: { x: CLEFT_ROUND, y: -30 }, p1: { x: 0,   y: -30 } },
]
const HEART_HALF_WIDTH  = 36
const HEART_HALF_HEIGHT = 38

// Scales+translates the unit segments into pixel space at the given center/scale.
function scaledSegs(cx, cy, S) {
  return HEART_UNIT_SEGS.map(seg => ({
    p0: { x: cx + seg.p0.x * S, y: cy + seg.p0.y * S },
    c1: { x: cx + seg.c1.x * S, y: cy + seg.c1.y * S },
    c2: { x: cx + seg.c2.x * S, y: cy + seg.c2.y * S },
    p1: { x: cx + seg.p1.x * S, y: cy + seg.p1.y * S },
  }))
}

function heartPath(ctx, segs) {
  ctx.moveTo(segs[0].p0.x, segs[0].p0.y)
  for (const s of segs) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y)
  ctx.closePath()
}

// Unit bbox — used both for the fit solve and vertical centering.
const UNIT_BBOX = bboxOf([
  { x: -HEART_HALF_WIDTH, y: 0 }, { x: HEART_HALF_WIDTH, y: 0 },
  { x: 0, y: -HEART_HALF_HEIGHT }, { x: 0, y: HEART_HALF_HEIGHT },
])

function drawScene(ctx, w, h) {
  // Salmon gradient — a flat two-stop version of the game's radial field
  // (its brightest center coral-red down to its deeper outer stop), matching
  // Triangle/HexagonCardPreview's linear two-stop card treatment. No
  // scenery on the card, just the gradient.
  const bg = ctx.createLinearGradient(0, 0, w * 0.5, h)
  bg.addColorStop(0, '#F5A084')
  bg.addColorStop(1, '#C25848')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // ── Heart geometry — mirrors HeartCanvas buildGeo ───────────────────────────
  // lw = (2·R)·0.0728·2 + 8, R = S·HEART_HALF_HEIGHT
  //    = S·HEART_HALF_HEIGHT·0.2912 + 8
  const m = HEART_HALF_HEIGHT * 0.2912
  const S = fitWithMargin(w, h, UNIT_BBOX.w, UNIT_BBOX.h, m, 8, SHAPE_VISUAL_WEIGHT.heart)
  const { cx, cy } = fitCenter(w, h, UNIT_BBOX, S)

  const R  = S * HEART_HALF_HEIGHT
  const circleR = (2 * R) * 0.0728
  const lw = circleR * 2 + 8

  const segs = scaledSegs(cx, cy, S)

  // Flat cream track — a single soft band (no shadow / highlight / inner wall).
  ctx.beginPath()
  heartPath(ctx, segs)
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = TRACK_COLOR
  ctx.stroke()

  // Quiet pacing dot at the cleft — the start of the breathe-in half.
  const dotX = cx
  const dotY = cy - 30 * S
  const dotR = lw * 0.62
  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
}

export default function HeartCardPreview({ className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0

    function render() {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)   // DPR-aware — crisp on retina
      ctx.clearRect(0, 0, w, h)
      drawScene(ctx, w, h)
    }

    render()
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(render)
    })
    ro.observe(canvas)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
