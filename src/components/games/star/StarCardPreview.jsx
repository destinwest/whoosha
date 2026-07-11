import { useEffect, useRef } from 'react'
import { roundedPolyPath } from '../_shared/roundedPolyPath'

// ── StarCardPreview ─────────────────────────────────────────────────────────
// The Star counterpart to Square/Hexagon/Triangle CardPreview: a soft, muted
// render of the Star game for the home carousel card. A calm "resting" state — a
// PLACEHOLDER morning gradient (no scenery, just the gradient) with the star-
// outline track in its bare base colour and a quiet pale pacing dot at the start
// valley. No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — a five-pointed star OUTLINE (10 vertices, one
// tip up) with the same inner ratio and a proportional corner radius — so the
// card reads as the real star track, just softened and quiet. Track is centered
// in the region between the card's top edge and the title (title center ≈ 0.86
// of card height in GameCarousel), so REGION_CENTER ≈ 0.43.
//
// Colors mirror StarGame / StarCanvas: morning-light sky + the #FCDF6C track.

const REGION_CENTER    = 0.43
const STAR_INNER_RATIO = 0.42        // matches StarCanvas
const TRACK_COLOR      = '#FCDF6C'   // matches the game track base

function drawScene(ctx, w, h) {
  // Sky gradient — matches StarGame's morning sky (softened sunrise stops).
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0.00, '#FCF6DB')
  sky.addColorStop(0.30, '#FBDAD6')
  sky.addColorStop(0.55, '#ECD5E4')
  sky.addColorStop(0.78, '#CFD2EE')
  sky.addColorStop(1.00, '#A7C2F7')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // ── Star-outline geometry — mirrors StarCanvas buildGeo (one tip up) ────────
  const R   = Math.min(w * 0.34, h * 0.30)
  const Ri  = R * STAR_INNER_RATIO
  const cx  = w / 2
  const cyc = h * REGION_CENTER

  // 10 vertices, valley before the top tip first (index 1 = top tip).
  const A0 = -Math.PI / 2 - Math.PI / 5
  const verts = []
  for (let j = 0; j < 10; j++) {
    const ang = A0 + j * (Math.PI / 5)
    const rad = (j % 2 === 0) ? Ri : R
    verts.push({ x: cx + rad * Math.cos(ang), y: cyc + rad * Math.sin(ang) })
  }

  const circleR = (2 * R) * 0.0728
  const lw      = (circleR * 2 + 8) * 0.85   // matches StarCanvas STAR_TRACK_SLIM
  // Corner radius — mirrors StarCanvas: sized above lw/2 so the stroked inner
  // edge stays rounded, clamped so both corner tangents on the tightest edge
  // (the sharp tips dominate) fit within 88% of the edge.
  const edgeLen = Math.hypot(verts[1].x - verts[0].x, verts[1].y - verts[0].y)
  const halfTan = []   // tan(|turn_i| / 2) per vertex
  for (let i = 0; i < 10; i++) {
    const p = verts[(i - 1 + 10) % 10], v = verts[i], q = verts[(i + 1) % 10]
    let ix = v.x - p.x, iy = v.y - p.y; const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il
    let ox = q.x - v.x, oy = q.y - v.y; const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol
    const turnAbs = Math.abs(Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy))
    halfTan.push(Math.tan(turnAbs / 2))
  }
  let maxEdgeTan = 0
  for (let i = 0; i < 10; i++) maxEdgeTan = Math.max(maxEdgeTan, halfTan[i] + halfTan[(i + 1) % 10])
  const r = Math.min(lw * 0.90, (0.88 * edgeLen) / maxEdgeTan)

  // Flat track — a single soft band (no shadow / highlight / inner wall).
  ctx.beginPath()
  roundedPolyPath(ctx, verts, r)
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = TRACK_COLOR
  ctx.stroke()

  // Quiet pacing dot at the start of the first breathe-in side (V0 valley → V1
  // top tip), inset past the corner so it sits on the straight run.
  const p   = verts[0]
  const q   = verts[1]
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  const inset = Math.min(r * 1.2, len * 0.35)
  const dotX = p.x + ((q.x - p.x) / len) * inset
  const dotY = p.y + ((q.y - p.y) / len) * inset
  const dotR = lw * 0.62
  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
}

export default function StarCardPreview({ className = '' }) {
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
