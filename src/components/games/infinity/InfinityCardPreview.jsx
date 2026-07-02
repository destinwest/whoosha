import { useEffect, useRef } from 'react'

// ── InfinityCardPreview ─────────────────────────────────────────────────────
// The Infinity counterpart to Square/HexagonCardPreview: a soft, muted render of
// the Infinity game for the home carousel card — a calm "resting" state that the
// launch cross-dissolve blooms into the vivid game. Deliberately NOT a faithful
// game frame: a quiet night gradient (a few faint stars, no Milky Way band /
// nebulae) and a flat lavender figure-8 track (no shadow), with one quiet pale
// pacing dot. No breathing labels.
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

// Tiny seeded PRNG so the faint star sprinkle is stable across re-draws.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

  // A few quiet stars for night identity.
  const rand = mulberry32(0x1FEED)
  const stars = Math.round((w * h) / 4200)
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < stars; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = 0.4 + rand() * rand() * 1.2
    ctx.fillStyle = `rgba(255,255,255,${(0.3 + rand() * 0.5).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

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

  // Flat lavender track — a single soft band (no shadow / highlight).
  ctx.beginPath()
  let [x0, y0] = pt(0)
  ctx.moveTo(x0, y0)
  for (let i = 1; i <= N; i++) { const [x, y] = pt(i / N); ctx.lineTo(x, y) }
  ctx.closePath()
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.lineCap     = 'round'
  ctx.strokeStyle = '#D0C4EC'
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
