import { useEffect, useRef } from 'react'
import { roundedPolyPath } from '../_shared/roundedPolyPath'

// ── TriangleCardPreview ─────────────────────────────────────────────────────
// The Triangle counterpart to Square/Hexagon CardPreview: a soft, muted render
// of the Triangle game for the home carousel card. A calm "resting" state — an
// alpine-sky gradient (no clouds, no scenery, just the gradient) with the slate
// mountain track in its bare base colour, and a quiet pale pacing dot at the
// start vertex. No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — a point-up equilateral triangle with the same
// corner ratio and track width — so the card reads as the real triangle track,
// just softened and quiet. The track is vertically centered in the region
// between the card's top edge and the title (title center ≈ 0.86 of card
// height in GameCarousel), so REGION_CENTER = (0 + 0.86)/2 ≈ 0.43.

const REGION_CENTER   = 0.43
const TRI_CORNER_RATIO = 0.28   // matches TriangleCanvas — see its own comment for the inner-margin math
const TRACK_COLOR     = '#93A4B2'   // the game track's base slate (drawTrackBody base stop)

function drawScene(ctx, w, h) {
  // Sky gradient — matches the game's baked alpine sky (photo-sampled hazy
  // blue: light → a deeper blue-teal band around 40% → light again). No
  // blobs/clouds on the card, just the gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0,    '#CAD8DD')
  sky.addColorStop(0.42, '#8FB8CE')
  sky.addColorStop(1,    '#CCDEE4')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // ── Triangle geometry — mirrors TriangleCanvas buildGeo (point-up) ──────────
  // Coefficients are the original 0.36/0.30 scaled up 15% (per user request).
  const R  = Math.min(w * 0.414, h * 0.345)
  const cx = w / 2
  // Place the centroid so the triangle's bounding box (apex R above, base R/2
  // below the centroid) centers on the region between the card top and title.
  const cyc = h * REGION_CENTER + R / 4
  const r   = R * TRI_CORNER_RATIO

  const hx = R * Math.cos(Math.PI / 6)   // half-width (= R·√3/2)
  const hy = R * 0.5                      // base sits R/2 below the centroid
  const verts = [
    { x: cx - hx, y: cyc + hy },   // V0 bottom-left (start)
    { x: cx,      y: cyc - R  },   // V1 apex
    { x: cx + hx, y: cyc + hy },   // V2 bottom-right
  ]

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
