import { useEffect, useRef } from 'react'
import { roundedPolyPath } from '../_shared/roundedPolyPath'

// ── HexagonCardPreview ──────────────────────────────────────────────────────
// The Hexagon counterpart to SquareCardPreview: a soft, muted render of the
// Hexagon game for the home carousel card — a calm "resting" state that the
// launch cross-dissolve blooms into the vivid game. Deliberately NOT a faithful
// game frame: a gentle sandstone gradient (no strata / grain / sun), a flat
// cream track (no shadow, highlight, or inner-wall shading), and a quiet pale
// pacing dot. No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — the same circumradius/corner ratios and the
// shortened vertical "hold" sides — so the card reads as the real hexagon
// track, just softened.

const CY_RATIO = 0.43   // track vertical center — shifted up from dead-center (0.50),
                        // same as SquareCardPreview: centers the track between the
                        // card's top edge and the title (title center ≈ 0.86 of card
                        // height in GameCarousel's CarouselCard, so (0 + 0.86)/2 ≈ 0.43).

function drawScene(ctx, w, h) {
  // Soft sandstone background — the card's warm gradient, none of the game's
  // strata / grain / raking sun.
  const bg = ctx.createLinearGradient(0, 0, w * 0.5, h)
  bg.addColorStop(0, '#E4B48C')
  bg.addColorStop(1, '#C77E5A')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // ── Hexagon geometry — mirrors HexagonCanvas buildGeo ──────────────────────
  const R  = Math.min(w * 0.39, h * 0.45)
  const cx = w / 2
  const cy = h * CY_RATIO
  const r  = R * 0.30

  const interior      = (6 - 2) * Math.PI / 6          // 120°
  const exterior      = Math.PI - interior             // 60°
  const cornerTangent = r / Math.tan(interior / 2)
  const LA            = r * exterior

  // Shortened hold sides (uniform pacing speed): total traced length of a hold
  // side is half a breathe side's, so solve for the shorter straight run.
  const LS_breathe   = R - 2 * cornerTangent
  const totalBreathe = LS_breathe + LA
  const LS_hold      = totalBreathe * 0.5 - LA
  const holdLen      = Math.max(2 * cornerTangent, LS_hold + 2 * cornerTangent)

  // Symmetric, irregular hexagon: breathe sides keep length R (±30°); the two
  // vertical hold sides shrink. Pointy top/bottom, vertical holds left/right.
  const a  = R * Math.cos(Math.PI / 6)
  const by = R * 0.5
  const hh = holdLen / 2
  const verts = [
    { x: cx - a, y: cy - hh      },   // V0 upper-left
    { x: cx,     y: cy - hh - by  },  // V1 top
    { x: cx + a, y: cy - hh      },   // V2 upper-right
    { x: cx + a, y: cy + hh      },   // V3 lower-right
    { x: cx,     y: cy + hh + by  },  // V4 bottom
    { x: cx - a, y: cy + hh      },   // V5 lower-left
  ]

  const circleR = (2 * R) * 0.0728
  const lw      = circleR * 2 + 8

  // Flat cream track — a single soft band (no shadow / highlight / inner wall).
  ctx.beginPath()
  roundedPolyPath(ctx, verts, r)
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = '#F2EAD0'
  ctx.stroke()

  // Quiet pacing dot at the start of the first breathe-in side (V0 → V1), inset
  // past the corner by the tangent length so it sits on the straight run.
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

export default function HexagonCardPreview({ className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0

    function render() {
      // clientWidth/Height = CSS layout size (unaffected by the carousel's
      // ancestor transforms), so the bitmap resolution is correct.
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
