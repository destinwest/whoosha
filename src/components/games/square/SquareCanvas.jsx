// ── SquareCanvas.jsx ──────────────────────────────────────────────────────────
// Canvas drawing component — renders the game canvas, owns the rAF loop,
// all geometry computation, all per-frame drawing, and all pointer handling.
//
// Props:
//   strokeModeRef  — { current: 'classic' | 'watercolor' }
//   onTick(now)    — called each rAF frame; SquareGame drives intro from here
//   onGameStart()  — called once when the child first drags from the start point
//   interactive    — boolean; controls pointer events on the canvas element
//
// Imperative API (via ref):
//   reset()        — clears all canvas state and resets all game-state refs
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import * as taperedStroke from './strokes/taperedStroke'
import * as layeredWash   from './strokes/layeredWash'

// ── Constants ─────────────────────────────────────────────────────────────────
const LAP_COLORS   = ['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7']
const CYCLE_MS     = 16_000
const LABEL_TEXTS  = ['breathe in', 'hold', 'breathe out', 'hold']
const LABEL_ANGLES = [0, -Math.PI / 2, 0, Math.PI / 2]
const ALPHA_ACTIVE = 0.75
const ALPHA_FLOOR  = 0.18
const SCALE_ACTIVE = 1.08
const BLEND_MS     = 600

const smoothstep = t => t * t * (3 - 2 * t)

// ── lerpColor ─────────────────────────────────────────────────────────────────
function lerpColor(hexA, hexB, t) {
  const ar = parseInt(hexA.slice(1, 3), 16)
  const ag = parseInt(hexA.slice(3, 5), 16)
  const ab = parseInt(hexA.slice(5, 7), 16)
  const br = parseInt(hexB.slice(1, 3), 16)
  const bg = parseInt(hexB.slice(3, 5), 16)
  const bb = parseInt(hexB.slice(5, 7), 16)
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`
}

// ── buildGeo ──────────────────────────────────────────────────────────────────
function buildGeo(rect) {
  const w    = rect.width
  const h    = rect.height
  const sq   = Math.min(w, h) * 0.78
  const cx   = w / 2
  const cy   = h / 2
  const half = sq / 2
  const r       = sq * 0.22
  const circleR = sq * 0.0728
  const lw      = circleR * 2 + 8

  const travelPx    = lw * 0.15
  const amberRadius = lw * 0.35

  const LS = sq - 2 * r
  const LA = (Math.PI * r) / 2
  const sf = LS / (LS + LA)

  const arcCenters = [
    { x: cx + half - r, y: cy + half - r },
    { x: cx + half - r, y: cy - half + r },
    { x: cx - half + r, y: cy - half + r },
    { x: cx - half + r, y: cy + half - r },
  ]
  const arcStartAngles = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]

  const straightFrom = [
    { x: cx - half + r, y: cy + half   },
    { x: cx + half,     y: cy + half - r },
    { x: cx + half - r, y: cy - half   },
    { x: cx - half,     y: cy - half + r },
  ]
  const straightTo = [
    { x: cx + half - r, y: cy + half   },
    { x: cx + half,     y: cy - half + r },
    { x: cx - half + r, y: cy - half   },
    { x: cx - half,     y: cy + half - r },
  ]

  const N      = 500
  const points = []
  for (let i = 0; i <= N; i++) {
    const frac = (i / N) * 4
    const si   = Math.min(Math.floor(frac), 3)
    const s    = frac - si
    if (s < sf) {
      const lt = s / sf
      const a  = straightFrom[si]
      const b  = straightTo[si]
      points.push({ x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt })
    } else {
      const arcT  = (s - sf) / (1 - sf)
      const ac    = arcCenters[si]
      const angle = arcStartAngles[si] - arcT * Math.PI / 2
      points.push({ x: ac.x + r * Math.cos(angle), y: ac.y + r * Math.sin(angle) })
    }
  }

  const startPt = { x: straightFrom[0].x, y: straightFrom[0].y }

  const labelMids = straightFrom.map((a, i) => ({
    x: (a.x + straightTo[i].x) / 2,
    y: (a.y + straightTo[i].y) / 2,
  }))

  return {
    cx, cy, sq, half, lw, r, sf,
    travelPx, amberRadius,
    arcCenters, arcStartAngles,
    straightFrom, straightTo,
    startPt, points, labelMids,
    w, h,
  }
}

// ── drawVignette ──────────────────────────────────────────────────────────────
function drawVignette(ctx, W, H) {
  const grad = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.30,
    W / 2, H / 2, Math.max(W, H) * 0.75,
  )
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.18)')

  ctx.save()
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

// ── Racetrack draw passes ─────────────────────────────────────────────────────
// geometry: { left, top, sqW, cr, lw } — all in CSS px, describing the track
// centerline path. Passed to each pass; all four use the same path geometry.

// Called once per resize — returns a radial gradient for Pass B.
// Must use the display canvas ctx (the gradient is consumed there each frame).
function buildTrackGradient(ctx, { left, top, sqW, lw }) {
  const cx     = left + sqW / 2
  const cy     = top  + sqW / 2
  const innerR = sqW / 2 - lw
  const outerR = sqW / 2
  const grad   = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
  grad.addColorStop(0,   '#FAF5EE')
  grad.addColorStop(0.4, '#F5EFE6')
  grad.addColorStop(1,   '#EDE5D8')
  return grad
}

// Pass A — outer shadow: bleeds outside track footprint, soft drop shadow.
function drawTrackShadow(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(left, top, sqW, sqW, cr)
  ctx.lineWidth   = lw + 7
  ctx.strokeStyle = 'rgba(62,94,82,0.22)'
  ctx.stroke()
  ctx.restore()
}

// Pass B — gradient body: main cream surface, lit from above.
// Falls back to plain cream if the gradient hasn't been built yet (pre-resize).
function drawTrackBody(ctx, { left, top, sqW, cr, lw }, trackGradient) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(left, top, sqW, sqW, cr)
  ctx.lineWidth   = lw
  ctx.strokeStyle = trackGradient ?? '#F5EFE6'
  ctx.stroke()
  ctx.restore()
}

// Pass C — highlight rim: thin bright sheen on the raised inner lip.
function drawTrackHighlight(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(
    left + lw * 0.4,
    top  + lw * 0.4,
    sqW  - lw * 0.8,
    sqW  - lw * 0.8,
    cr   - lw * 0.4,
  )
  ctx.lineWidth   = lw * 0.15
  ctx.strokeStyle = 'rgba(255,252,245,0.55)'
  ctx.stroke()
  ctx.restore()
}

// Pass D — inner wall shadow: faint dark stroke along the inner boundary.
// Path at left + lw*0.5 = the actual inner edge of the track stroke.
// (left + lw would be lw/2 past the inner edge — inside the hole and invisible.)
function drawTrackInnerWall(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(
    left + lw * 0.5,
    top  + lw * 0.5,
    sqW  - lw,
    sqW  - lw,
    Math.max(0, cr - lw * 0.5),
  )
  ctx.lineWidth   = lw * 0.18
  ctx.strokeStyle = 'rgba(62,94,82,0.14)'
  ctx.stroke()
  ctx.restore()
}

// ── applyPaintClip ────────────────────────────────────────────────────────────
// Applies a permanent annular clip to a canvas context.
// save() is intentionally never restored — the clip must persist.
function applyPaintClip(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(left, top, sqW, sqW, cr)
  ctx.roundRect(
    left + lw,
    top  + lw,
    sqW  - lw * 2,
    sqW  - lw * 2,
    Math.max(0, cr - lw),
  )
  ctx.clip('evenodd')
}

// ── SquareCanvas ──────────────────────────────────────────────────────────────
const SquareCanvas = forwardRef(function SquareCanvas(
  { strokeModeRef, onTick, onGameStart, interactive },
  ref,
) {
  // ── Canvas infrastructure ──────────────────────────────────────────────────
  const canvasRef   = useRef(null)
  const paintRef    = useRef(null)
  const rafRef      = useRef(null)
  const geoRef      = useRef(null)
  const dprRef      = useRef(window.devicePixelRatio || 1)
  const paintCtxRef      = useRef(null)
  const clipArgsRef      = useRef(null)
  const trackGeoRef      = useRef(null)   // CSS px track centerline geometry
  const trackGradientRef = useRef(null)   // cached Pass B gradient (rebuilt on resize)

  // ── Game state refs ────────────────────────────────────────────────────────
  const gameStartRef         = useRef(null)
  const startedRef           = useRef(false)
  const touchRef             = useRef(false)
  const childPosRef          = useRef(null)
  const lastChildPos         = useRef(null)
  const lapColorIdxRef       = useRef(0)
  const prevFracRef          = useRef(null)
  const pacingPosRef         = useRef(null)
  const lastEncouragementRef = useRef(-Infinity)
  const encouragementRef     = useRef(null)
  const pulseRef             = useRef(0)
  const pulseAlpha           = useRef(1)
  const startLabelAlpha      = useRef(1)
  const lastMoveTimeRef      = useRef(0)

  // ── Imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    reset() {
      // Clear canvas content — taperedStroke.clear() wipes via canvas.width
      // reassignment (destroying the clip), so we reapply it immediately.
      taperedStroke.clear()
      if (paintCtxRef.current && clipArgsRef.current) {
        applyPaintClip(paintCtxRef.current, clipArgsRef.current)
      }
      layeredWash.clear()

      // Reset all game state
      startedRef.current           = false
      touchRef.current             = false
      childPosRef.current          = null
      lastChildPos.current         = null
      prevFracRef.current          = null
      gameStartRef.current         = null
      lapColorIdxRef.current       = 0
      pulseRef.current             = 0
      pulseAlpha.current           = 1
      startLabelAlpha.current      = 1
      lastEncouragementRef.current = -Infinity
      encouragementRef.current     = null
    },
  }), [])

  // ── Lap color ──────────────────────────────────────────────────────────────
  function getLapColor(fraction) {
    const idx = lapColorIdxRef.current
    return lerpColor(
      LAP_COLORS[idx       % LAP_COLORS.length],
      LAP_COLORS[(idx + 1) % LAP_COLORS.length],
      fraction / 4,
    )
  }

  // ── Pacing circle position ─────────────────────────────────────────────────
  function getPacing(elapsed) {
    const geo = geoRef.current
    if (!geo) return null
    const { sf, straightFrom, straightTo, arcCenters, arcStartAngles, r } = geo

    const fraction = ((elapsed % CYCLE_MS) / CYCLE_MS) * 4
    const si       = Math.min(Math.floor(fraction), 3)
    const s        = fraction - si

    if (s < sf) {
      const lt = s / sf
      const a  = straightFrom[si]
      const b  = straightTo[si]
      return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt, fraction }
    } else {
      const arcT  = (s - sf) / (1 - sf)
      const ac    = arcCenters[si]
      const angle = arcStartAngles[si] - arcT * Math.PI / 2
      return { x: ac.x + r * Math.cos(angle), y: ac.y + r * Math.sin(angle), fraction }
    }
  }

  // ── Project finger onto path, clamp lateral drift ─────────────────────────
  function project(px, py) {
    const geo = geoRef.current
    if (!geo) return null
    const { points, travelPx } = geo
    const N    = points.length - 1
    let   best = { dist: Infinity, x: 0, y: 0, fraction: 0, tdx: 1, tdy: 0 }

    for (let i = 0; i < N; i++) {
      const a   = points[i]
      const b   = points[i + 1]
      const dx  = b.x - a.x
      const dy  = b.y - a.y
      const lsq = dx * dx + dy * dy
      if (lsq === 0) continue
      const t  = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lsq))
      const nx = a.x + t * dx
      const ny = a.y + t * dy
      const d  = Math.hypot(px - nx, py - ny)
      if (d < best.dist) {
        best = { dist: d, x: nx, y: ny, fraction: (i + t) / N * 4, tdx: dx, tdy: dy }
      }
    }

    const { x: clx, y: cly, fraction, tdx, tdy } = best
    const tLen = Math.hypot(tdx, tdy)
    const tx   = tdx / tLen
    const ty   = tdy / tLen
    const nx   = -ty
    const ny   =  tx

    const lateralOffset = (px - clx) * nx + (py - cly) * ny
    const clampedOffset = Math.max(-travelPx, Math.min(travelPx, lateralOffset))

    return {
      dist: best.dist,
      x: clx + nx * clampedOffset,
      y: cly + ny * clampedOffset,
      clx, cly,
      fraction,
    }
  }

  // ── Lap detection ──────────────────────────────────────────────────────────
  function checkLap(pos) {
    if (!pos) return
    const prev = prevFracRef.current
    if (prev !== null && prev > 3.7 && pos.fraction < 0.3) onLapComplete()
    prevFracRef.current = pos.fraction
  }

  function onLapComplete() {
    lapColorIdxRef.current++
    const now    = performance.now()
    const pacing = pacingPosRef.current
    const child  = childPosRef.current
    if (pacing && child) {
      const dist = Math.hypot(child.clx - pacing.x, child.cly - pacing.y)
      if (lapColorIdxRef.current > 1 && dist <= 60 && now - lastEncouragementRef.current > 30_000) {
        encouragementRef.current     = { startTime: now }
        lastEncouragementRef.current = now
      }
    }
  }

  // ── Stroke delegation ──────────────────────────────────────────────────────
  function addStrokePoint(x, y, vel) {
    if (strokeModeRef.current === 'watercolor') {
      layeredWash.addPoint(x, y, vel)
    } else {
      taperedStroke.addPoint(x, y, vel)
    }
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return
    if (!startedRef.current) {
      if (Math.hypot(px - geo.startPt.x, py - geo.startPt.y) <= geo.lw) {
        startedRef.current      = true
        gameStartRef.current    = performance.now()
        touchRef.current        = true
        lastMoveTimeRef.current = performance.now()
        onGameStart?.()
        const pos = project(px, py)
        childPosRef.current  = pos
        lastChildPos.current = pos
        prevFracRef.current  = pos?.fraction ?? null
        if (pos) addStrokePoint(pos.x, pos.y, 0)
      }
    } else {
      touchRef.current        = true
      lastMoveTimeRef.current = performance.now()
      const pos               = project(px, py)
      childPosRef.current     = pos
      lastChildPos.current    = pos
      prevFracRef.current     = pos?.fraction ?? null
      if (pos) addStrokePoint(pos.x, pos.y, 0)
    }
  }

  function onPointerMove(px, py) {
    if (!startedRef.current || !touchRef.current) return
    const last = lastChildPos.current
    if (last && Math.hypot(px - last.x, py - last.y) < 0.5) return

    const now  = performance.now()
    const dt   = now - lastMoveTimeRef.current
    const dist = last ? Math.hypot(px - last.x, py - last.y) : 0
    const vel  = dt > 0 ? dist / dt : 0
    lastMoveTimeRef.current = now

    const pos = project(px, py)
    childPosRef.current  = pos
    lastChildPos.current = pos
    checkLap(pos)
    if (pos) {
      const color = getLapColor(pos.fraction)
      taperedStroke.updateColor(color, lapColorIdxRef.current)
      layeredWash.updateColor(color, lapColorIdxRef.current)
      addStrokePoint(pos.x, pos.y, vel)
    }
  }

  function onPointerUp() {
    touchRef.current = false
    taperedStroke.lift()
    layeredWash.lift()
  }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

  // ── drawLabels ─────────────────────────────────────────────────────────────
  function drawLabels(ctx, geo, now) {
    const { labelMids, sq, sf } = geo
    const fs = Math.max(13, sq * 0.048)

    const pacFrac  = startedRef.current
      ? (((now - gameStartRef.current) % CYCLE_MS) / CYCLE_MS) * 4
      : 0
    const rawBlend = startedRef.current
      ? Math.min(1, (now - gameStartRef.current) / BLEND_MS)
      : 0
    const blend = smoothstep(rawBlend)

    for (let i = 0; i < 4; i++) {
      const localFrac = ((pacFrac - i) % 4 + 4) % 4

      let proximity
      if (localFrac <= sf / 2) {
        proximity = 1
      } else if (localFrac <= sf) {
        proximity = smoothstep(1 - (localFrac - sf / 2) / (sf / 2))
      } else if (localFrac >= 3 + sf / 2) {
        proximity = smoothstep((localFrac - (3 + sf / 2)) / (1 - sf / 2))
      } else {
        proximity = 0
      }

      const alphaProx = ALPHA_FLOOR + (ALPHA_ACTIVE - ALPHA_FLOOR) * proximity
      const scaleProx = 1.0 + (SCALE_ACTIVE - 1.0) * proximity
      const alpha     = ALPHA_ACTIVE + (alphaProx - ALPHA_ACTIVE) * blend
      const scale     = 1.0          + (scaleProx - 1.0)          * blend

      const mid = labelMids[i]
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(mid.x, mid.y)
      ctx.rotate(LABEL_ANGLES[i])
      ctx.scale(scale, scale)
      ctx.font         = `700 ${fs}px 'Nunito', sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle    = 'rgba(44,74,62,1)'
      ctx.fillText(LABEL_TEXTS[i], 0, 0)
      ctx.restore()
    }
  }

  // ── Main animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    const paintCanvas = document.createElement('canvas')
    paintRef.current  = paintCanvas

    let lastW = 0, lastH = 0

    function resize() {
      dprRef.current = window.devicePixelRatio || 1
      const dpr      = dprRef.current
      const rect     = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      if (rect.width === lastW && rect.height === lastH) return
      lastW = rect.width
      lastH = rect.height

      canvas.width       = rect.width  * dpr
      canvas.height      = rect.height * dpr
      paintCanvas.width  = rect.width  * dpr
      paintCanvas.height = rect.height * dpr
      geoRef.current     = buildGeo(rect)

      const { cx, cy, sq, half, lw, r } = geoRef.current
      const paintCtx = paintCanvas.getContext('2d')
      paintCtxRef.current = paintCtx

      const clipArgs = {
        left: (cx - half - lw / 2) * dpr,
        top:  (cy - half - lw / 2) * dpr,
        sqW:  (half * 2 + lw) * dpr,
        cr:   (r + lw / 2) * dpr,
        lw:   lw * dpr,
      }
      clipArgsRef.current = clipArgs

      applyPaintClip(paintCtx, clipArgs)

      // Track geometry for the four racetrack draw passes (CSS px, centerline).
      const trackGeo = { left: cx - half, top: cy - half, sqW: sq, cr: r, lw }
      trackGeoRef.current      = trackGeo
      trackGradientRef.current = buildTrackGradient(ctx, trackGeo)

      const idx   = lapColorIdxRef.current
      const color = lerpColor(
        LAP_COLORS[idx       % LAP_COLORS.length],
        LAP_COLORS[(idx + 1) % LAP_COLORS.length],
        0,
      )
      taperedStroke.init({ paintCtx, lw, dpr, color, lapColorIdx: idx })
      layeredWash.init({ paintCtx, lw, dpr, color, lapColorIdx: idx, clipArgs })
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function frame() {
      rafRef.current = requestAnimationFrame(frame)

      const geo = geoRef.current
      if (!geo) return

      const now = performance.now()
      onTick?.(now)

      const dpr = dprRef.current
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { cx, cy, sq, half, lw, amberRadius, r, startPt } = geo

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 0. Background vignette ────────────────────────────────────────────
      drawVignette(ctx, W, H)

      // ── 1. Racetrack — four passes ────────────────────────────────────────
      const trackGeo = trackGeoRef.current
      if (trackGeo) {
        drawTrackShadow(ctx, trackGeo)
        drawTrackBody(ctx, trackGeo, trackGradientRef.current)
        drawTrackHighlight(ctx, trackGeo)
        drawTrackInnerWall(ctx, trackGeo)
      }

      // ── 2. Paint layer ────────────────────────────────────────────────────
      if (strokeModeRef.current === 'watercolor') {
        const wLayers = layeredWash.getLayers()
        for (const { canvas: lc } of wLayers) {
          ctx.drawImage(lc, 0, 0, W, H)
        }
      } else {
        ctx.drawImage(paintCanvas, 0, 0, W, H)
      }

      // ── 3. Labels ─────────────────────────────────────────────────────────
      drawLabels(ctx, geo, now)

      // ── 4. Pacing circle ──────────────────────────────────────────────────
      {
        const pacingPos = startedRef.current
          ? getPacing(now - gameStartRef.current)
          : { x: startPt.x, y: startPt.y }
        if (pacingPos) {
          pacingPosRef.current = pacingPos
          ctx.beginPath()
          ctx.arc(pacingPos.x, pacingPos.y, lw * 0.62, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fill()
        }
      }

      // ── 5. Amber circle ───────────────────────────────────────────────────
      {
        const FADE_RATE = 0.033
        if (startedRef.current) {
          pulseAlpha.current      = Math.max(0, pulseAlpha.current      - FADE_RATE)
          startLabelAlpha.current = Math.max(0, startLabelAlpha.current - FADE_RATE)
        }

        pulseRef.current += 0.05
        const p = Math.sin(pulseRef.current)

        const displayPos = !startedRef.current
          ? { x: startPt.x, y: startPt.y }
          : (lastChildPos.current || { x: startPt.x, y: startPt.y })

        if (pulseAlpha.current > 0) {
          ctx.beginPath()
          ctx.arc(displayPos.x, displayPos.y, amberRadius * 1.7 + p * amberRadius * 0.15, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(212,160,86,${((0.25 + p * 0.1) * pulseAlpha.current).toFixed(3)})`
          ctx.lineWidth   = 2.5
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(displayPos.x, displayPos.y, amberRadius * 2.3 + p * amberRadius * 0.15, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(212,160,86,${((0.12 + p * 0.05) * pulseAlpha.current).toFixed(3)})`
          ctx.lineWidth   = 2
          ctx.stroke()
        }

        ctx.beginPath()
        ctx.arc(displayPos.x, displayPos.y, amberRadius, 0, Math.PI * 2)
        ctx.fillStyle = '#D4A056'
        ctx.fill()

        if (startLabelAlpha.current > 0) {
          const startFs = Math.max(14, lw * 0.44)
          ctx.font         = `800 ${startFs}px 'Nunito', sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.strokeStyle  = `rgba(212,160,86,${startLabelAlpha.current.toFixed(3)})`
          ctx.lineWidth    = 6
          ctx.lineJoin     = 'round'
          ctx.strokeText('start', displayPos.x, displayPos.y)
          ctx.fillStyle    = `rgba(255,255,255,${startLabelAlpha.current.toFixed(3)})`
          ctx.fillText('start', displayPos.x, displayPos.y)
        }
      }

      // ── 6. Encouragement moment ───────────────────────────────────────────
      const enc = encouragementRef.current
      if (enc) {
        const t = (now - enc.startTime) / 2_000
        if (t < 1) {
          const alpha = 1 - t
          const glowR = half * 1.2
          const grad  = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
          grad.addColorStop(0, `rgba(212,160,86,${(alpha * 0.3).toFixed(3)})`)
          grad.addColorStop(1, 'rgba(212,160,86,0)')
          ctx.beginPath()
          ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()

          const fs = Math.max(16, sq * 0.065)
          ctx.save()
          ctx.font         = `600 ${fs}px 'Nunito', sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.shadowBlur   = 8
          ctx.shadowColor  = 'rgba(255,255,255,0.6)'
          ctx.fillStyle    = `rgba(255,255,255,${(alpha * 0.92).toFixed(3)})`
          ctx.fillText('Beautiful work 🌟', cx, cy)
          ctx.restore()
        } else {
          encouragementRef.current = null
        }
      }

      ctx.restore()
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // intentional [] deps — all mutable state lives in refs, all props read via ref

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ touchAction: 'none', pointerEvents: interactive ? 'auto' : 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    />
  )
})

export default SquareCanvas
