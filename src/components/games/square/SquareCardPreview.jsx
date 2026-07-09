import { useEffect, useRef } from 'react'

// ── SquareCardPreview ───────────────────────────────────────────────────────
// A soft, muted render of the Square game for the home carousel card — a calm,
// low-stimulation "resting" state before FadeLaunch cross-dissolves into the
// vivid game (an opaque veil fade, not a positional zoom — the card's track
// position doesn't need to match the game's on-screen position). Deliberately
// NOT a faithful game frame: a dark teal background sourced from the bottom
// of the game's meadow-bg gradient (no light shafts / sun pools / dapples),
// a flat track (no shadow or inner-wall shading), and a quiet pale pacing dot.
// No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware.

const SIZE_RATIO   = 0.70     // sq / min(w, h)
const RADIUS_RATIO = 0.22     // corner radius / sq
const CIRCLE_RATIO = 0.0728   // track width = 2·(sq·CIRCLE_RATIO) + 8
const CY_RATIO     = 0.43     // track vertical center — shifted up from dead-center (0.50)
                              // so the track sits centered in the space between the card's
                              // top edge and the title text (title center ≈ 0.86 of card
                              // height in GameCarousel's CarouselCard, so (0 + 0.86)/2 ≈ 0.43).

function drawScene(ctx, w, h) {
  // Dark teal background — the two darkest stops from the game's own
  // meadow-bg gradient (buildMeadowBg in SquareGame.jsx), muted, with none
  // of the game's light shafts / sun pools / canopy dapples.
  const bg = ctx.createLinearGradient(0, 0, w * 0.5, h)
  bg.addColorStop(0, '#094E44')
  bg.addColorStop(1, '#082B26')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const sq      = Math.min(w, h) * SIZE_RATIO
  const half    = sq / 2
  const cx      = w / 2
  const cy      = h * CY_RATIO
  const cornerR = sq * RADIUS_RATIO
  const lw      = sq * CIRCLE_RATIO * 2 + 8
  const left    = cx - half
  const top     = cy - half

  // Flat track — a single soft band (no shadow / highlight / inner wall),
  // matching the game's base track color (SquareCanvas buildTrackGradient).
  ctx.beginPath()
  ctx.roundRect(left, top, sq, sq, cornerR)
  ctx.lineWidth   = lw
  ctx.strokeStyle = '#8A6D57'
  ctx.stroke()

  // Quiet pacing dot at the start of the bottom side — soft, no glow.
  const dotR = lw * 0.62
  ctx.beginPath()
  ctx.arc(cx - half + cornerR, cy + half, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#F4F0E6'
  ctx.fill()
}

export default function SquareCardPreview({ className = '' }) {
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
