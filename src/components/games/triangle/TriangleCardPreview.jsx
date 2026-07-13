import { useEffect, useRef } from 'react'
import { roundedPolyPath } from '../_shared/roundedPolyPath'
import { bboxOf, fitWithMargin, fitCenter, SHAPE_VISUAL_WEIGHT } from '../_shared/cardLayout'

// ── TriangleCardPreview ─────────────────────────────────────────────────────
// The Triangle counterpart to Square/Hexagon CardPreview: a soft, muted render
// of the Triangle game for the home carousel card. A calm "resting" state — a
// simple two-stop sky-blue gradient (no ridges/scenery, just the gradient —
// same treatment as HexagonCardPreview's sandstone gradient) with the slate
// mountain track in its bare base colour, and a quiet pale pacing dot at the
// start vertex. No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — a point-up equilateral triangle with the same
// corner ratio and track width — so the card reads as the real triangle track,
// just softened and quiet. Size/position come from the shared cardLayout
// module: buildVerts(1, 0, 0)'s real bounding box (apex R above center, base
// R/2 below — asymmetric) drives both the fit and the vertical centering, no
// manual offset needed.

const TRI_CORNER_RATIO = 0.28   // matches TriangleCanvas — see its own comment for the inner-margin math
const TRACK_COLOR     = '#93A4B2'   // the game track's base slate (drawTrackBody base stop)

// Pure function of R (circumradius-ish) and center — point-up equilateral
// triangle. Used both for the unit (R=1) bounding box and the final verts.
function buildVerts(R, cx, cyc) {
  const hx = R * Math.cos(Math.PI / 6)   // half-width (= R·√3/2)
  const hy = R * 0.5                      // base sits R/2 below the centroid
  return [
    { x: cx - hx, y: cyc + hy },   // V0 bottom-left (start)
    { x: cx,      y: cyc - R  },   // V1 apex
    { x: cx + hx, y: cyc + hy },   // V2 bottom-right
  ]
}

function drawScene(ctx, w, h) {
  // Sky gradient — a single hue pulled from the game's vibrant sky-blue (its
  // brightest, most saturated point), light → rich, matching
  // HexagonCardPreview's `createLinearGradient(0,0,w*0.5,h)` two-stop pattern
  // so the two cards read as the same family. No ridges/scenery on the card,
  // just the gradient.
  const sky = ctx.createLinearGradient(0, 0, w * 0.5, h)
  sky.addColorStop(0, '#8BB8E4')
  sky.addColorStop(1, '#5C91C7')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // ── Triangle geometry — mirrors TriangleCanvas buildGeo (point-up) ──────────
  const unitBBox = bboxOf(buildVerts(1, 0, 0))
  // lw = (2R)·0.0728·2 + 8 = R·0.2912 + 8 — see circleR/lw below.
  const R  = fitWithMargin(w, h, unitBBox.w, unitBBox.h, 0.2912, 8, SHAPE_VISUAL_WEIGHT.triangle)
  const { cx, cy: cyc } = fitCenter(w, h, unitBBox, R)
  const r   = R * TRI_CORNER_RATIO

  const verts = buildVerts(R, cx, cyc)

  const circleR = (2 * R) * 0.0728
  const lw      = circleR * 2 + 8

  // Flat slate track — a single soft band (no shadow / highlight / inner wall).
  ctx.beginPath()
  roundedPolyPath(ctx, verts, r)
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = TRACK_COLOR
  ctx.stroke()

  // Quiet pacing dot at the start of the first breathe-in side (V0 → V1), inset
  // past the corner by the tangent length so it sits on the straight run.
  const cornerTangent = r / Math.tan(Math.PI / 6)   // 60° interior → r/tan(30°)
  const p   = verts[0]
  const q   = verts[1]
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  const dotX = p.x + ((q.x - p.x) / len) * cornerTangent
  const dotY = p.y + ((q.y - p.y) / len) * cornerTangent
  const dotR = lw * 0.62
  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
}

export default function TriangleCardPreview({ className = '' }) {
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
