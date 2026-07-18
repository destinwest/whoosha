import { useEffect, useRef } from 'react'
import { REGION_CENTER_RATIO } from '../_shared/cardLayout'

// ── RainbowCardPreview ────────────────────────────────────────────────────────
// The Rainbow counterpart to the other games' CardPreviews: a soft, muted
// render of the Rainbow game for the home carousel card. A calm "resting"
// state — the first-light cream sky, the four pastel bands, the two clouds,
// and a quiet pale pacing dot resting in the left cloud (where the climb
// begins). No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. Geometry and colors
// mirror RainbowCanvas/RainbowGame, proportioned for the card's aspect.

const BAND_BASES = ['#CDB9E6', '#B5D9B7', '#F4E4A8', '#EFB3A6']   // matches RainbowCanvas
const CLOUD_FILL = '#FDFAF1'

function drawScene(ctx, w, h) {
  // First-light sky — matches RainbowGame's baked background stops.
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0.00, '#FEFAE6')
  sky.addColorStop(0.45, '#FBF0CC')
  sky.addColorStop(1.00, '#F6E4AE')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // Rainbow proportions — mirrors buildGeo, scaled to the card.
  const size   = Math.min(w * 0.86, h * 0.62)
  const lw     = size * 0.075
  const gap    = 0                        // bands sit flush — matches the game (no dividing slivers)
  const step   = lw + gap
  const outerR = size / 2 - lw / 2
  const radii  = [outerR - 3 * step, outerR - 2 * step, outerR - step, outerR]
  const cx     = w / 2

  // Center the rainbow + clouds block in the region above the title, matching
  // every other card (cardLayout.REGION_CENTER_RATIO), instead of the old
  // hand-tuned low placement. The painted block runs from the arc's top
  // (baseY − outerR − lw/2) down to where the clouds hang below the baseline;
  // centering its midpoint on the region center solves for baseY.
  const cloudDrop = lw * 1.9                        // clouds hang ~this far below the baseline
  const baseY     = h * REGION_CENTER_RATIO + (outerR + lw / 2) / 2 - cloudDrop / 2

  // Bands, bottom → top (purple, green, yellow, red).
  for (let a = 0; a < 4; a++) {
    ctx.beginPath()
    ctx.arc(cx, baseY, radii[a], Math.PI, Math.PI * 2, false)
    ctx.lineWidth   = lw
    ctx.lineCap     = 'butt'
    ctx.strokeStyle = BAND_BASES[a]
    ctx.stroke()
  }

  // Clouds over the arc ends.
  const spanMid = (radii[0] + radii[3]) / 2
  const cloudW  = (radii[3] - radii[0] + lw) * 1.5
  for (const side of [-1, 1]) {
    const ccx = cx + side * spanMid
    const ccy = baseY + lw * 0.3
    const rBig = cloudW * 0.24
    const puffs = [
      { x: ccx,                 y: ccy,               r: rBig },
      { x: ccx - cloudW * 0.28, y: ccy + rBig * 0.22, r: rBig * 0.78 },
      { x: ccx + cloudW * 0.28, y: ccy + rBig * 0.22, r: rBig * 0.78 },
      { x: ccx - cloudW * 0.14, y: ccy - rBig * 0.52, r: rBig * 0.66 },
      { x: ccx + cloudW * 0.16, y: ccy - rBig * 0.46, r: rBig * 0.60 },
    ]
    ctx.beginPath()
    for (const p of puffs) {
      ctx.moveTo(p.x + p.r, p.y)
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    }
    ctx.fillStyle = CLOUD_FILL
    ctx.fill()
  }

  // Quiet pacing dot resting in the left cloud (the climb's start).
  const dotR = lw * 0.62
  ctx.beginPath()
  ctx.arc(cx - radii[0], baseY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.lineWidth   = 1.5
  ctx.strokeStyle = 'rgba(212,160,86,0.55)'
  ctx.stroke()
}

export default function RainbowCardPreview({ className = '' }) {
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
