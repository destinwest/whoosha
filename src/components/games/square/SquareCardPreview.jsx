import { useEffect, useRef } from 'react'
import { buildMeadowBg } from './SquareGame'

// ── SquareCardPreview ───────────────────────────────────────────────────────
// A static render of the Square game's OPENING FRAME for the home carousel
// card — background, track, the resting pacing circle, and the breathing
// labels — so the card reads as the actual game (and is the seamless target
// for the zoom-into-the-card transition later).
//
// It reproduces SquareGame/SquareCanvas's render exactly: the diagonal meadow
// gradient, the four track passes, the translucent-white resting pacing circle
// (rgba 255,255,255,0.55, r = lw·0.62), and the four side labels (Nunito 700,
// rgba 44,74,62). Drawn ONCE per mount/resize (no rAF loop), DPR-aware.
//
// Standalone reproduction (not a shared import) to keep the live game untouched.
// Values are mirrored from SquareCanvas.buildGeo + the draw passes; if the game's
// look changes, sync here (or lift both into one shared module).

// Geometry ratios — copied from SquareCanvas.buildGeo.
const SIZE_RATIO   = 0.70     // sq / min(w, h) — ~90% of the prior size, now over the full card
const CY_RATIO     = 0.42     // track vertical center as a fraction of height (raised 10% of card height)
const RADIUS_RATIO = 0.22     // corner radius / sq
const CIRCLE_RATIO = 0.0728   // circle radius / sq  (track width = 2·circleR + 8)
const LABEL_RATIO  = 0.075    // label font size / sq (card-tuned to read as boldly as the game's labels)

// Breathing labels — sequence + per-side text rotation, matching SquareGame.
const LABELS = ['breathe in', 'hold', 'breathe out', 'hold']
const LABEL_ANGLES = [0, -Math.PI / 2, 0, Math.PI / 2]

function drawScene(ctx, w, h, dpr) {
  // ── Background: the game's actual meadow render (gradient + sun pools +
  // canopy dapples + light shafts), via the shared buildMeadowBg. Pixel-identical
  // to the game; textureImg=null skips only the fine moss tile. ──
  ctx.drawImage(buildMeadowBg(w, h, dpr, null), 0, 0, w, h)

  // ── Track geometry. ──
  const sq      = Math.min(w, h) * SIZE_RATIO
  const half    = sq / 2
  const cx      = w / 2
  const cy      = h * CY_RATIO
  const cornerR = sq * RADIUS_RATIO
  const lw      = sq * CIRCLE_RATIO * 2 + 8
  const left    = cx - half
  const top     = cy - half

  // Pass B gradient (radial, lit from inner edge outward).
  const innerR = Math.max(0, sq / 2 - lw / 2)
  const outerR = sq * 0.75
  const grad   = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
  grad.addColorStop(0,   '#FAF2E0')
  grad.addColorStop(0.4, '#F2EAD0')
  grad.addColorStop(1,   '#E6DBBF')

  // Pass A — outer soft shadow.
  ctx.beginPath()
  ctx.roundRect(left, top, sq, sq, cornerR)
  ctx.lineWidth   = lw + 7
  ctx.strokeStyle = 'rgba(78,68,40,0.22)'
  ctx.stroke()

  // Pass B — gradient body.
  ctx.beginPath()
  ctx.roundRect(left, top, sq, sq, cornerR)
  ctx.lineWidth   = lw
  ctx.strokeStyle = grad
  ctx.stroke()

  // Pass C — bright inner highlight rim.
  ctx.beginPath()
  ctx.roundRect(left + lw * 0.5, top + lw * 0.5, sq - lw, sq - lw, Math.max(0, cornerR - lw * 0.5))
  ctx.lineWidth   = lw * 0.15
  ctx.strokeStyle = 'rgba(255,252,245,0.55)'
  ctx.stroke()

  // Pass D — faint inner-wall shadow.
  ctx.beginPath()
  ctx.roundRect(left + lw * 0.5, top + lw * 0.5, sq - lw, sq - lw, Math.max(0, cornerR - lw * 0.5))
  ctx.lineWidth   = lw * 0.18
  ctx.strokeStyle = 'rgba(78,68,40,0.14)'
  ctx.stroke()

  // ── Breathing labels at the four side midpoints. ──
  const mids = [
    { x: cx,        y: cy + half },  // bottom — breathe in
    { x: cx + half, y: cy        },  // right  — hold
    { x: cx,        y: cy - half },  // top    — breathe out
    { x: cx - half, y: cy        },  // left   — hold
  ]
  ctx.fillStyle    = 'rgba(44,74,62,1)'
  ctx.font         = `700 ${(sq * LABEL_RATIO).toFixed(1)}px 'Nunito', sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 4; i++) {
    ctx.save()
    ctx.translate(mids[i].x, mids[i].y)
    ctx.rotate(LABEL_ANGLES[i])
    ctx.fillText(LABELS[i], 0, 0)
    ctx.restore()
  }

  // ── Resting pacing circle (translucent white) at the start of the bottom side. ──
  // Game start (fraction 0) is the bottom-left corner; place it at the start of
  // the bottom straight, matching SquareCanvas (rgba 255,255,255,0.55, r = lw·0.62).
  const circleR = lw * 0.62
  const px = cx - half + cornerR
  const py = cy + half
  // Warm amber glow underneath (the game's emphasized look) so the pacing
  // circle reads clearly on the small card, then a bright near-opaque core.
  const glowR = circleR * 1.8
  const glow  = ctx.createRadialGradient(px, py, circleR * 0.4, px, py, glowR)
  glow.addColorStop(0, 'rgba(255,200,130,0.6)')
  glow.addColorStop(1, 'rgba(255,200,130,0)')
  ctx.beginPath()
  ctx.arc(px, py, glowR, 0, Math.PI * 2)
  ctx.fillStyle = glow
  ctx.fill()
  ctx.beginPath()
  ctx.arc(px, py, circleR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,250,242,0.95)'
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
      // ancestor scale/rotate transforms), so the bitmap resolution is correct
      // and the card transform just scales the finished canvas (≤1.0 → crisp).
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawScene(ctx, w, h, dpr)
    }

    render()
    // Re-render once web fonts are ready so the labels use Nunito, not a fallback.
    if (document.fonts?.ready) document.fonts.ready.then(render)
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
