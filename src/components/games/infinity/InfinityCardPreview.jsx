import { useEffect, useRef } from 'react'
import { fitWithMargin, REGION_CENTER_RATIO, SHAPE_VISUAL_WEIGHT } from '../_shared/cardLayout'

// ── InfinityCardPreview ─────────────────────────────────────────────────────
// The Infinity counterpart to Square/HexagonCardPreview: a soft, muted render of
// the Infinity game for the home carousel card — a calm "resting" state that the
// launch cross-dissolve blooms into the vivid game. Deliberately NOT a faithful
// game frame: a quiet, dimmed version of the lake surface (see lakeSurface.js —
// muted shore shallows at the bottom rising into calm aquamarine) with a soft
// central glow and a vignette darkening the edges (mirroring the game's own
// vignette overlay — see InfinityGame.jsx), no ripple bands, and a "Liquid
// Glass" translucent figure-8 track — a uniform tinted glass body,
// background showing through — with one quiet pale pacing dot. No breathing
// labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — the same vertical lemniscate + track-width
// handle — so the card reads as the real infinity track, just softened and
// sized to sit above the card title. Size/position come from the shared
// cardLayout module: unlike the polygon shapes, the lemniscate's unit (widthC
// = 1) bounding box is exact by construction (RAW is the curve's true max
// |x|, and the vertical lobes reach exactly ±ASPECT/2 — see pt()) rather than
// numerically derived, so it's passed straight to fitWithMargin instead of
// via bboxOf/buildVerts. Track thickness (lw) is computed independently of
// widthC — see its own comment below for why.

const ASPECT = 2.2                    // figure height:width — matches the game
const RAW    = 1 / (2 * Math.SQRT2)   // max |x| of the raw lemniscate

function drawScene(ctx, w, h) {
  // Soft lake gradient — the game's palette, dimmed and calmed (no ripples).
  // Bottom-up like the game: muted gray-brown shallows into quiet aquamarine.
  const bg = ctx.createLinearGradient(0, h, 0, 0)
  bg.addColorStop(0.00, '#6E6B5E')
  bg.addColorStop(0.25, '#41816F')
  bg.addColorStop(0.65, '#2BA893')
  bg.addColorStop(1.00, '#3FBFAC')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Faint central aqua glow — the game's upper-center vibrancy, softened.
  const cy = h * REGION_CENTER_RATIO
  const glow = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.55)
  glow.addColorStop(0, 'rgba(110,228,206,0.18)')
  glow.addColorStop(1, 'rgba(110,228,206,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // ── Figure-8 geometry — mirrors InfinityCanvas buildGeo (card-tuned fit) ────
  const cx = w / 2
  // Track thickness is sized off the card's own scale — independent of
  // widthC — mirroring the game's own buildGeo. (An earlier version tied lw
  // to widthC directly; since this fit is usually height-bound — the tall
  // ASPECT lemniscate hits the vertical margin before the horizontal one —
  // that made widthC, and so the track, thinner than the card's actual
  // horizontal budget allowed.)
  const sizeHandle = Math.min(w, h) * 0.78
  const lw = sizeHandle * 0.0728 * 2 + 8

  // Unit (widthC = 1) bounding box is exact: width 1, height ASPECT. lw is a
  // fixed constant here (not a function of widthC), so m = 0.
  const widthC = fitWithMargin(w, h, 1, ASPECT, 0, lw, SHAPE_VISUAL_WEIGHT.infinity)
  const scaleX = widthC / (2 * RAW)
  // V_COMPRESS pulls the top/bottom lobes in toward the middle without
  // touching widthC's own fit above, so the card gets more clearance from
  // its top edge and the title without changing the track's width or margin.
  const V_COMPRESS = 0.85
  const scaleY = (ASPECT * widthC * V_COMPRESS) / 2

  // Vertical lemniscate, starting at the center (s=0), top lobe first.
  const N = 260
  const pt = (s) => {
    const t = (3 * Math.PI) / 2 + s * 2 * Math.PI
    const ct = Math.cos(t), st = Math.sin(t), d = 1 + st * st
    return [cx + ((st * ct) / d) * scaleX, cy - (ct / d) * scaleY]
  }

  // "Liquid Glass" figure-8 track (iOS control-center style): a uniform
  // tinted, translucent glass body so the night gradient/glow shows through.
  // Built as: (1) stroke the path fully opaque onto an offscreen canvas as a
  // shape MASK, (2) 'source-in' a flat translucent fill into that mask. The
  // figure-8 crosses itself at the center — stroking directly with a
  // translucent color would double-composite the overlap into a dark patch
  // (see git history); routing through an opaque mask first means the fill
  // lands on every track pixel, including the crossover, exactly once.
  const dpr = ctx.canvas.width / w
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width  = ctx.canvas.width
  maskCanvas.height = ctx.canvas.height
  const mctx = maskCanvas.getContext('2d')
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  mctx.beginPath()
  let [x0, y0] = pt(0)
  mctx.moveTo(x0, y0)
  for (let i = 1; i <= N; i++) { const [x, y] = pt(i / N); mctx.lineTo(x, y) }
  mctx.closePath()
  mctx.lineWidth   = lw
  mctx.lineJoin    = 'round'
  mctx.lineCap     = 'round'
  mctx.strokeStyle = '#fff'
  mctx.stroke()

  mctx.globalCompositeOperation = 'source-in'
  mctx.fillStyle = 'rgba(216,246,239,0.12)'   // flat glass tint — cool pale aqua for the lake scene
  mctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(maskCanvas, 0, 0)
  ctx.restore()

  // Quiet pacing dot at the top apex of the inhale lobe (s = 0.25) — a clean,
  // uncluttered spot away from the center crossover.
  const [dotX, dotY] = pt(0.25)
  ctx.beginPath()
  ctx.arc(dotX, dotY, lw * 0.62, 0, Math.PI * 2)
  ctx.fillStyle = '#F0FBF7'
  ctx.fill()

  // Vignette — darker at the edges, lighter in the middle. Mirrors the
  // game's own vignette overlay (InfinityGame.jsx: 'radial-gradient(ellipse
  // at 50% 50%, transparent 40%, rgba(8,52,48,0.38) 100%)' — deep teal, not
  // black, so the water darkens toward its own depths), drawn last so it
  // sits over everything, same as the game's DOM stacking (a CSS overlay
  // above the game canvas).
  const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w / 2, h / 2))
  vignette.addColorStop(0.4, 'rgba(8,52,48,0)')
  vignette.addColorStop(1,   'rgba(8,52,48,0.40)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)
}

export default function InfinityCardPreview({ className = '' }) {
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
