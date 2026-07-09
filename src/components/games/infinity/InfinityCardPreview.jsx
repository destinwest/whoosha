import { useEffect, useRef } from 'react'

// ── InfinityCardPreview ─────────────────────────────────────────────────────
// The Infinity counterpart to Square/HexagonCardPreview: a soft, muted render of
// the Infinity game for the home carousel card — a calm "resting" state that the
// launch cross-dissolve blooms into the vivid game. Deliberately NOT a faithful
// game frame: a quiet night gradient with a soft central glow (no stars, no
// Milky Way band / nebulae) and a "Liquid Glass" translucent figure-8 track —
// a uniform tinted glass body, background showing through, plus a subtle
// specular highlight near the top-lobe crown — with one quiet pale pacing
// dot. No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — the same vertical lemniscate + track-width
// handle — so the card reads as the real infinity track, just softened and sized
// to sit above the card title.

const ASPECT = 2.2                    // figure height:width — matches the game
const RAW    = 1 / (2 * Math.SQRT2)   // max |x| of the raw lemniscate
const VFILL  = 0.74                   // card-tuned: leave room for the bottom title
const WFILL  = 0.80
const CY     = 0.43                   // track vertical center, nudged up off the title

function drawScene(ctx, w, h) {
  // Soft night gradient — the game's palette, dimmed and calmed (no band/nebulae).
  const bg = ctx.createLinearGradient(0, 0, w * 0.4, h)
  bg.addColorStop(0,   '#1B1F4D')
  bg.addColorStop(0.6, '#241F50')
  bg.addColorStop(1,   '#141238')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Faint central violet glow.
  const glow = ctx.createRadialGradient(w / 2, h * CY, 0, w / 2, h * CY, Math.max(w, h) * 0.55)
  glow.addColorStop(0, 'rgba(120,95,190,0.18)')
  glow.addColorStop(1, 'rgba(120,95,190,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // ── Figure-8 geometry — mirrors InfinityCanvas buildGeo (card-tuned fit) ────
  const cx = w / 2
  const cy = h * CY
  const sizeHandle = Math.min(w, h) * 0.78
  const lw = sizeHandle * 0.0728 * 2 + 8
  const widthC = Math.max(16, Math.min(w * WFILL - lw, (h * VFILL - lw) / ASPECT))
  const scaleX = widthC / (2 * RAW)
  const scaleY = (ASPECT * widthC) / 2

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
  mctx.fillStyle = 'rgba(150,140,182,0.10)'   // flat glass tint — the previous gradient's dimmest stop
  mctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(maskCanvas, 0, 0)
  ctx.restore()

  // Subtle specular highlight near the crown of the top lobe — echoes the
  // bright rim catching the light on the reference Liquid Glass icons. A
  // short, thin, soft-capped arc; this span doesn't cross itself, so it can
  // be stroked directly (no mask needed).
  const HI_FROM = 0.15, HI_TO = 0.35, HI_N = 40
  ctx.beginPath()
  let [hx0, hy0] = pt(HI_FROM)
  ctx.moveTo(hx0, hy0)
  for (let i = 1; i <= HI_N; i++) {
    const [hx, hy] = pt(HI_FROM + (HI_TO - HI_FROM) * (i / HI_N))
    ctx.lineTo(hx, hy)
  }
  ctx.lineWidth   = lw * 0.2
  ctx.lineCap     = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.stroke()

  // Quiet pacing dot at the top apex of the inhale lobe (s = 0.25) — a clean,
  // uncluttered spot away from the center crossover.
  const [dotX, dotY] = pt(0.25)
  ctx.beginPath()
  ctx.arc(dotX, dotY, lw * 0.62, 0, Math.PI * 2)
  ctx.fillStyle = '#EDE7FA'
  ctx.fill()
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
