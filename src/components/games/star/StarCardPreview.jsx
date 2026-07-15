import { useEffect, useRef } from 'react'
import { bboxOf, fitWithMargin, fitCenter, REGION_CENTER_RATIO, SHAPE_VISUAL_WEIGHT } from '../_shared/cardLayout'

// ── StarCardPreview ─────────────────────────────────────────────────────────
// The Star counterpart to Square/Hexagon/Triangle CardPreview: a soft, muted
// render of the Star game for the home carousel card. A calm "resting" state —
// mirroring InfinityCardPreview's treatment of the same night sky: a quiet
// night gradient with a soft central glow (no stars, no Milky Way band /
// nebulae — the launch cross-dissolve blooms into the full baked sky), the
// star-outline track in its bare base colour, and a quiet pale pacing dot
// resting at the top tip (the game dot's actual start). No breathing labels.
//
// Drawn ONCE per mount/resize (no rAF loop), DPR-aware. The track geometry
// mirrors the game's buildGeo — a five-pointed star OUTLINE (10 vertices, one
// tip up) with the same inner ratio and a proportional corner radius — so the
// card reads as the real star track, just softened and quiet. Size/position
// come from the shared cardLayout module — see its header for the fit/weight
// logic (the star's slim points get a perceptual-size boost there).
//
// Colors mirror StarGame / StarCanvas: night sky (see _shared/nightSky.js,
// dimmed and calmed here like InfinityCardPreview) + the #FCDF6C track.

const STAR_INNER_RATIO = 0.42        // matches StarCanvas
const TRACK_COLOR      = '#FCDF6C'   // matches the game track base

// Pure function of outer radius R and center — 10-vertex star outline, one
// tip up. Used both for the unit (R=1) bounding box and the final verts.
function buildVerts(R, cx, cyc) {
  const Ri = R * STAR_INNER_RATIO
  const A0 = -Math.PI / 2 - Math.PI / 5
  const verts = []
  for (let j = 0; j < 10; j++) {
    const ang = A0 + j * (Math.PI / 5)
    const rad = (j % 2 === 0) ? Ri : R
    verts.push({ x: cx + rad * Math.cos(ang), y: cyc + rad * Math.sin(ang) })
  }
  return verts
}

function drawScene(ctx, w, h) {
  // Soft night gradient — the game's night-sky palette, dimmed and calmed
  // (no stars/band/nebulae). Same stops as InfinityCardPreview so the two
  // night-sky cards read as one family.
  const sky = ctx.createLinearGradient(0, 0, w * 0.4, h)
  sky.addColorStop(0,   '#1B1F4D')
  sky.addColorStop(0.6, '#241F50')
  sky.addColorStop(1,   '#141238')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // Faint central violet glow — mirrors InfinityCardPreview (same center ratio).
  const glowCy = h * REGION_CENTER_RATIO
  const glow = ctx.createRadialGradient(w / 2, glowCy, 0, w / 2, glowCy, Math.max(w, h) * 0.55)
  glow.addColorStop(0, 'rgba(120,95,190,0.18)')
  glow.addColorStop(1, 'rgba(120,95,190,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // ── Star-outline geometry — mirrors StarCanvas buildGeo (one tip up) ────────
  const unitBBox = bboxOf(buildVerts(1, 0, 0))
  // lw = ((2R)·0.0728·2 + 8)·0.85 = R·0.24752 + 6.8 (STAR_TRACK_SLIM applied) — see below.
  const R   = fitWithMargin(w, h, unitBBox.w, unitBBox.h, 0.24752, 6.8, SHAPE_VISUAL_WEIGHT.star)
  const { cx, cy: cyc } = fitCenter(w, h, unitBBox, R)

  // 10 vertices, valley before the top tip first (index 1 = top tip).
  const verts = buildVerts(R, cx, cyc)

  const circleR = (2 * R) * 0.0728
  const lw      = (circleR * 2 + 8) * 0.85   // matches StarCanvas STAR_TRACK_SLIM

  // Per-vertex edge directions + SIGNED turns. The star outline is CONCAVE —
  // valleys are reflex corners with a negative turn — which is why the earlier
  // roundedPolyPath/arcTo draw was wrong here: arcTo only handles convex
  // corners, and combined with the path seam on the valley→top-tip edge it
  // made the stroke diverge from itself into a visible bump at the star's top.
  // This is the same reason StarCanvas's buildGeo constructs its own rounded
  // centerline; the block below is a card-scale port of that construction.
  const n = 10
  const uOut = []   // unit direction of the edge leaving vertex i
  const turn = []   // signed deflection at vertex i
  for (let i = 0; i < n; i++) {
    const p = verts[(i - 1 + n) % n], v = verts[i], q = verts[(i + 1) % n]
    let ix = v.x - p.x, iy = v.y - p.y; const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il
    let ox = q.x - v.x, oy = q.y - v.y; const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol
    uOut.push({ x: ox, y: oy })
    turn.push(Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy))
  }

  // Corner radius — mirrors StarCanvas: sized above lw/2 so the stroked inner
  // edge stays rounded, clamped so both corner tangents on the tightest edge
  // (the sharp tips dominate) fit within 88% of the edge.
  const edgeLen = Math.hypot(verts[1].x - verts[0].x, verts[1].y - verts[0].y)
  let maxEdgeTan = 0
  for (let i = 0; i < n; i++) {
    const sum = Math.tan(Math.abs(turn[i]) / 2) + Math.tan(Math.abs(turn[(i + 1) % n]) / 2)
    maxEdgeTan = Math.max(maxEdgeTan, sum)
  }
  const r = Math.min(lw * 0.90, (0.88 * edgeLen) / maxEdgeTan)

  // Rounded centerline — straight runs + signed corner arcs (arc center offset
  // along the signed normal: left of travel at convex tips, right at reflex
  // valleys), sampled and stroked as one closed polyline. Same construction as
  // StarCanvas buildGeo, coarser sampling (12 segments/arc is plenty at card
  // scale). Drawn once per resize — per-frame cost stays zero.
  const Ttan = turn.map(t => r * Math.tan(Math.abs(t) / 2))   // per-vertex tangent length
  const ARC_STEPS = 12
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % n]
    const u = uOut[i]
    const from = { x: a.x + u.x * Ttan[i],           y: a.y + u.y * Ttan[i] }
    const to   = { x: b.x - u.x * Ttan[(i + 1) % n], y: b.y - u.y * Ttan[(i + 1) % n] }
    if (i === 0) ctx.moveTo(from.x, from.y)
    else         ctx.lineTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)

    // Corner arc at vertex i+1 (belongs to this side).
    const sweep  = turn[(i + 1) % n]
    const nrm    = sweep >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x }
    const center = { x: to.x + nrm.x * r, y: to.y + nrm.y * r }
    const a0     = Math.atan2(to.y - center.y, to.x - center.x)
    for (let k = 1; k <= ARC_STEPS; k++) {
      const ang = a0 + sweep * (k / ARC_STEPS)
      ctx.lineTo(center.x + r * Math.cos(ang), center.y + r * Math.sin(ang))
    }
  }
  ctx.closePath()

  // Flat track — a single soft band (no shadow / highlight / inner wall).
  ctx.lineWidth   = lw
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = TRACK_COLOR
  ctx.stroke()

  // Quiet pacing dot resting at the TOP TIP's arc midpoint — where the game's
  // pacing dot actually starts (pacingArcOrigin, since the 2026-07-11 top-tip
  // change; the old card dot sat inset along the valley→tip run, a leftover
  // from the earlier valley start). Family-standard size (lw·0.62, matching
  // Square/Hexagon cards), centered on the track centerline.
  const u0     = uOut[0]                                  // side 0 runs valley V0 → top tip V1
  const to0    = { x: verts[1].x - u0.x * Ttan[1], y: verts[1].y - u0.y * Ttan[1] }
  const nrm0   = turn[1] >= 0 ? { x: -u0.y, y: u0.x } : { x: u0.y, y: -u0.x }
  const c0     = { x: to0.x + nrm0.x * r, y: to0.y + nrm0.y * r }
  const midAng = Math.atan2(to0.y - c0.y, to0.x - c0.x) + turn[1] / 2
  ctx.beginPath()
  ctx.arc(c0.x + r * Math.cos(midAng), c0.y + r * Math.sin(midAng), lw * 0.62, 0, Math.PI * 2)
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
