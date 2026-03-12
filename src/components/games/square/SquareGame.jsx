import { useState, useRef, useEffect } from 'react'
import IntroScreen from './IntroScreen'
import StrokeSelector from './StrokeSelector'
import SquareCanvas from './SquareCanvas'

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_COLOR = '#F5EFE6'
const LAP_COLORS = ['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7']
const CYCLE_MS   = 16_000

// ── Color helpers ─────────────────────────────────────────────────────────────
// Linearly interpolate between two hex colors, returning an rgb() string.
function lerpColor(hexA, hexB, t) {
  const ar = parseInt(hexA.slice(1, 3), 16)
  const ag = parseInt(hexA.slice(3, 5), 16)
  const ab = parseInt(hexA.slice(5, 7), 16)
  const br = parseInt(hexB.slice(1, 3), 16)
  const bg = parseInt(hexB.slice(3, 5), 16)
  const bb = parseInt(hexB.slice(5, 7), 16)
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`
}

// ── Intro timeline (ms) ───────────────────────────────────────────────────────
const INTRO_TEXT_MS   = 4_000
const INTRO_FLOOD_MS  = 4_000
const INTRO_RECEDE_MS = 4_000
const INTRO_FADE_MS   =   500
const INTRO_TOTAL_MS  = INTRO_TEXT_MS + INTRO_FLOOD_MS + INTRO_RECEDE_MS

// ── Label constants ───────────────────────────────────────────────────────────
const LABEL_TEXTS    = ['breathe in', 'hold', 'breathe out', 'hold']
const LABEL_ANGLES   = [0, -Math.PI / 2, 0, Math.PI / 2]
const ALPHA_ACTIVE   = 0.75
const ALPHA_FLOOR    = 0.18
const SCALE_ACTIVE   = 1.08
const BLEND_MS       = 600

const smoothstep = t => t * t * (3 - 2 * t)

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

  const travelPx    = lw * 0.15   // max lateral drift off centerline in CSS px
  const amberRadius = lw * 0.35   // amber circle radius in CSS px

  const LS = sq - 2 * r
  const LA = (Math.PI * r) / 2
  const sf = LS / (LS + LA)   // scalar — all four sides are identical

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

  const outNormals = [
    { x:  0, y:  1 },
    { x:  1, y:  0 },
    { x:  0, y: -1 },
    { x: -1, y:  0 },
  ]
  const railOffset = lw * 0.32

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

  // Midpoint of each straight segment — label anchor points
  const labelMids = straightFrom.map((a, i) => ({
    x: (a.x + straightTo[i].x) / 2,
    y: (a.y + straightTo[i].y) / 2,
  }))

  return {
    cx, cy, sq, half, lw, circleR, r, sf,
    travelPx, amberRadius,
    arcCenters, arcStartAngles,
    straightFrom, straightTo,
    outNormals, railOffset,
    startPt, points, labelMids,
    w, h,
  }
}

// ── SquareGame ────────────────────────────────────────────────────────────────
export default function SquareGame({ onExit }) {

  // ── Phase & overlay ────────────────────────────────────────────────────────
  const [showIntro, setShowIntro]           = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(1)
  const [overlayColor, setOverlayColor]     = useState('#2C4A3E')
  const [activeStroke, setActiveStroke]     = useState('classic')

  const introStartRef                       = useRef(null)
  const introDoneRef                        = useRef(false)
  const textRef                             = useRef(null)   // IntroScreen text container
  const line1Ref                            = useRef(null)   // first line of intro text
  const line2Ref                            = useRef(null)   // second line of intro text

  // ── Refs ───────────────────────────────────────────────────────────────────
  const canvasRef  = useRef(null)
  const paintRef   = useRef(null)
  const rafRef     = useRef(null)
  const geoRef     = useRef(null)

  const sessionStartRef = useRef(Date.now())
  const gameStartRef    = useRef(null)

  const startedRef   = useRef(false)
  const touchRef     = useRef(false)
  const childPosRef  = useRef(null)
  const lastChildPos = useRef(null)

  const lapColorIdxRef = useRef(0)
  const prevFracRef    = useRef(null)

  const pacingPosRef = useRef(null)

  const lastEncouragementRef = useRef(-Infinity)
  const encouragementRef     = useRef(null)

  const pulseRef        = useRef(0)
  const pulseAlpha      = useRef(1)
  const startLabelAlpha = useRef(1)

  const dprRef         = useRef(window.devicePixelRatio || 1)
  const lastMoveTimeRef = useRef(0)

  const strokeModeRef     = useRef('classic')
  const squareCanvasRef   = useRef(null)

  // ── Reset to start state ───────────────────────────────────────────────────
  // Delegates canvas-level cleanup to SquareCanvas, then resets all game-state
  // refs back to their initial values. Called when the stroke style is changed.
  function resetToStartState() {
    squareCanvasRef.current?.reset()

    startedRef.current   = false
    touchRef.current     = false
    childPosRef.current  = null
    lastChildPos.current = null
    prevFracRef.current      = null
    gameStartRef.current     = null
    lapColorIdxRef.current   = 0
    pulseRef.current         = 0
    pulseAlpha.current       = 1
    startLabelAlpha.current  = 1
    lastEncouragementRef.current = 0
    encouragementRef.current     = null
  }

  // ── Stroke selection ────────────────────────────────────────────────────────
  function handleStrokeSelect(newStroke) {
    if (newStroke === strokeModeRef.current) return  // no-op if same
    strokeModeRef.current = newStroke
    setActiveStroke(newStroke)
    resetToStartState()
  }

  // ── Intro timeline ─────────────────────────────────────────────────────────
  function tickIntro(now) {
    if (introDoneRef.current) return
    if (!introStartRef.current) introStartRef.current = now
    const elapsed = now - introStartRef.current

    // Line 1: fades in immediately over 0.5s
    if (line1Ref.current) {
      line1Ref.current.style.opacity = Math.min(1, Math.max(0, elapsed / 500))
    }

    // Line 2: 2s delay, fades in over 2s (fully visible at 4s)
    if (line2Ref.current) {
      line2Ref.current.style.opacity = Math.min(1, Math.max(0, (elapsed - 2_000) / 2_000))
    }

    // All text fades out over the last 1s of the flood phase — gone at peak brightness
    if (textRef.current) {
      const fadeStart = INTRO_TEXT_MS + INTRO_FLOOD_MS - 1_000
      const textAlpha = elapsed < fadeStart
        ? 1
        : Math.max(0, 1 - (elapsed - fadeStart) / 1_000)
      textRef.current.style.opacity = textAlpha
    }

    const setOverlay = (opacity, color) => {
      setOverlayOpacity(opacity)
      if (color !== undefined) setOverlayColor(color)
    }

    if (elapsed < INTRO_TEXT_MS) {
      setOverlay(1, '#2C4A3E')
    } else if (elapsed < INTRO_TEXT_MS + INTRO_FLOOD_MS) {
      const t = smoothstep((elapsed - INTRO_TEXT_MS) / INTRO_FLOOD_MS)
      const r = Math.round(44  + (245 - 44) * t)
      const g = Math.round(74  + (239 - 74) * t)
      const b = Math.round(62  + (230 - 62) * t)
      setOverlay(1, `rgb(${r},${g},${b})`)
    } else if (elapsed < INTRO_TOTAL_MS) {
      const t = smoothstep((elapsed - INTRO_TEXT_MS - INTRO_FLOOD_MS) / INTRO_RECEDE_MS)
      setOverlay(1 - t, '#F5EFE6')
    } else if (elapsed < INTRO_TOTAL_MS + INTRO_FADE_MS) {
      setOverlay(0)
    } else {
      introDoneRef.current    = true
      sessionStartRef.current = Date.now()
      setShowIntro(false)
    }
  }

  function skipIntro() {
    if (introDoneRef.current) return
    introDoneRef.current      = true
    sessionStartRef.current   = Date.now()
    setShowIntro(false)
    setOverlayOpacity(0)
  }

  // ── Draw labels on canvas ──────────────────────────────────────────────────
  function drawLabels(ctx, geo, now) {
    const { labelMids, sq, sf } = geo
    const fs = Math.max(13, sq * 0.048)

    const pacFrac = startedRef.current
      ? ((((now - gameStartRef.current) % CYCLE_MS) / CYCLE_MS) * 4)
      : 0

    const rawBlend = startedRef.current
      ? Math.min(1, (now - gameStartRef.current) / BLEND_MS)
      : 0
    const blend = smoothstep(rawBlend)

    for (let i = 0; i < 4; i++) {
      // localFrac: pacing circle position relative to side i.
      //   0      = side i straight start
      //   sf     = side i straight end
      //   3+sf/2 = midpoint of side i-1's straight (rise begins)
      //   ~4     = end of corner arc, entering side i
      const localFrac = ((pacFrac - i) % 4 + 4) % 4

      // Three-phase proximity:
      //
      // Rise  — pacing circle in the second half of side i-1's straight through
      //         the corner arc. Starts at floor, peaks at side i entry.
      //         Window: localFrac ∈ [3 + sf/2, 4)
      //
      // Hold  — pacing circle in the first half of side i's straight.
      //         Stays at peak the whole time.
      //         Window: localFrac ∈ [0, sf/2]
      //
      // Fall  — pacing circle past the centre of side i's straight.
      //         Falls from peak to floor by the end of the straight.
      //         Window: localFrac ∈ (sf/2, sf]
      let proximity
      if (localFrac <= sf / 2) {
        // Hold at peak
        proximity = 1
      } else if (localFrac <= sf) {
        // Fall: centre of straight → end of straight
        proximity = smoothstep(1 - (localFrac - sf / 2) / (sf / 2))
      } else if (localFrac >= 3 + sf / 2) {
        // Rise: midpoint of previous straight → entry of side i
        proximity = smoothstep((localFrac - (3 + sf / 2)) / (1 - sf / 2))
      } else {
        proximity = 0
      }

      const alphaProx = ALPHA_FLOOR + (ALPHA_ACTIVE - ALPHA_FLOOR) * proximity
      const scaleProx = 1.0 + (SCALE_ACTIVE - 1.0) * proximity

      const alpha = ALPHA_ACTIVE + (alphaProx - ALPHA_ACTIVE) * blend
      const scale = 1.0          + (scaleProx - 1.0)          * blend

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

  // ── Pacing circle ──────────────────────────────────────────────────────────
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

  // ── Project finger onto path centerline, then clamp lateral drift only ───────
  // Returns:
  //   x, y      — clamped position (amber circle + paint origin)
  //   clx, cly  — nearest centerline point (lap detection + encouragement check)
  //   fraction  — centerline-based path progress (lap detection)
  //   dist      — raw Euclidean distance from finger to centerline
  //
  // Algorithm:
  //   1. Find the nearest point on the centerline polyline (clx, cly) and
  //      capture the tangent direction of that segment.
  //   2. Derive the path normal: normal = { -tangent.y, tangent.x }.
  //   3. Project the finger's offset onto the normal to get the signed
  //      lateral offset — the purely sideways drift, ignoring longitudinal
  //      position along the path.
  //   4. Clamp that lateral offset to ±travelPx.
  //   5. The clamped position is clPoint + normal * clampedOffset.
  //
  // Longitudinal movement (finger ahead/behind along the path) is untouched —
  // only the sideways component is constrained.
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

    // Tangent unit vector at the nearest point.
    const { dist, x: clx, y: cly, fraction, tdx, tdy } = best
    const tLen = Math.hypot(tdx, tdy)
    const tx   = tdx / tLen   // tangent x
    const ty   = tdy / tLen   // tangent y

    // Normal points 90° left of the tangent (outward from the path center).
    const nx = -ty
    const ny =  tx

    // Signed lateral offset: how far the finger sits to the left or right
    // of the centerline, measured perpendicular to the path direction.
    const lateralOffset  = (px - clx) * nx + (py - cly) * ny
    const clampedOffset  = Math.max(-travelPx, Math.min(travelPx, lateralOffset))

    return {
      dist,
      x: clx + nx * clampedOffset,
      y: cly + ny * clampedOffset,
      clx, cly,
      fraction,
    }
  }

  // ── Lap detection ──────────────────────────────────────────────────────────
  function checkLap(pos) {
    if (!pos) return
    const frac = pos.fraction
    const prev = prevFracRef.current
    if (prev !== null && prev > 3.7 && frac < 0.3) onLapComplete()
    prevFracRef.current = frac
  }

  function onLapComplete() {
    lapColorIdxRef.current++
    const now    = performance.now()
    const pacing = pacingPosRef.current
    const child  = childPosRef.current
    if (pacing && child) {
      // Compare centerline positions — lateral drift does not affect this check.
      const dist = Math.hypot(child.clx - pacing.x, child.cly - pacing.y)
      if (lapColorIdxRef.current > 1 && dist <= 60 && now - lastEncouragementRef.current > 30_000) {
        encouragementRef.current     = { startTime: now }
        lastEncouragementRef.current = now
      }
    }
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    cancelAnimationFrame(rafRef.current)
    const dur = Math.round((Date.now() - sessionStartRef.current) / 1000)
    onExit(dur)
  }

  // ── Lap color ─────────────────────────────────────────────────────────────
  // Compute the interpolated stroke color for the current path position.
  // Interpolates continuously from the current lap color to the next across
  // one full lap, so the color arrives at the next value exactly at the
  // lap boundary — no discrete jump.
  function getLapColor(fraction) {
    const idx = lapColorIdxRef.current
    return lerpColor(
      LAP_COLORS[idx       % LAP_COLORS.length],
      LAP_COLORS[(idx + 1) % LAP_COLORS.length],
      fraction / 4,
    )
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
      const dist = Math.hypot(px - geo.startPt.x, py - geo.startPt.y)
      if (dist <= geo.lw) {
        startedRef.current      = true
        gameStartRef.current    = performance.now()
        touchRef.current        = true
        lastMoveTimeRef.current = performance.now()
        const pos               = project(px, py)
        childPosRef.current     = pos
        lastChildPos.current    = pos
        prevFracRef.current     = pos?.fraction ?? null
        // Register the touch-down position as the stroke anchor (no segment drawn).
        if (pos) squareCanvasRef.current?.addPoint(pos.x, pos.y, 0)
      }
    } else {
      touchRef.current        = true
      lastMoveTimeRef.current = performance.now()
      const pos               = project(px, py)
      childPosRef.current     = pos
      lastChildPos.current    = pos
      prevFracRef.current     = pos?.fraction ?? null
      if (pos) squareCanvasRef.current?.addPoint(pos.x, pos.y, 0)
    }
  }

  function onPointerMove(px, py) {
    if (!startedRef.current || !touchRef.current) return
    const last = lastChildPos.current
    if (last && Math.hypot(px - last.x, py - last.y) < 0.5) return

    // Velocity in CSS px/ms — used by watercolor module; tapered ignores it.
    const now  = performance.now()
    const dt   = now - lastMoveTimeRef.current
    const dist = last ? Math.hypot(px - last.x, py - last.y) : 0
    const vel  = dt > 0 ? dist / dt : 0
    lastMoveTimeRef.current = now

    const pos = project(px, py)
    // Update position and lap index before painting so the interpolated color
    // is correct when a lap boundary is crossed mid-move.
    childPosRef.current  = pos
    lastChildPos.current = pos
    checkLap(pos)
    if (pos) {
      squareCanvasRef.current?.updateColor(getLapColor(pos.fraction), lapColorIdxRef.current)
      squareCanvasRef.current?.addPoint(pos.x, pos.y, vel)
    }
  }

  function onPointerUp() {
    touchRef.current = false
    squareCanvasRef.current?.lift()
  }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

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

      // Resizing resets the paint canvas state (including any prior clip).
      // SquareCanvas.init() applies the clip then re-inits both stroke modules
      // with the new geometry and fresh context state.
      const { cx, cy, half, lw: cssLw, r } = geoRef.current
      const paintCtx = paintCanvas.getContext('2d')
      squareCanvasRef.current?.init({
        paintCtx,
        cssLw,
        dpr,
        color:       getLapColor(0),
        lapColorIdx: lapColorIdxRef.current,
        clipArgs: {
          left: (cx - half - cssLw / 2) * dpr,
          top:  (cy - half - cssLw / 2) * dpr,
          sqW:  (half * 2 + cssLw) * dpr,
          cr:   (r + cssLw / 2) * dpr,
          lw:   cssLw * dpr,
        },
      })
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function frame() {
      rafRef.current = requestAnimationFrame(frame)

      const geo = geoRef.current
      if (!geo) return

      const now = performance.now()
      if (!introDoneRef.current) tickIntro(now)

      const dpr = dprRef.current
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { cx, cy, sq, half, lw, amberRadius, r, startPt } = geo

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 1. Racetrack ─────────────────────────────────────────────────────
      ctx.beginPath()
      ctx.roundRect(cx - half, cy - half, sq, sq, r)
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.strokeStyle = BASE_COLOR
      ctx.lineWidth   = lw
      ctx.stroke()

      // ── 3. Paint layer ───────────────────────────────────────────────────
      if (strokeModeRef.current === 'watercolor') {
        const wLayers = squareCanvasRef.current?.getWatercolorLayers() ?? []
        for (const { canvas: lc } of wLayers) {
          ctx.drawImage(lc, 0, 0, W, H)
        }
      } else {
        ctx.drawImage(paintCanvas, 0, 0, W, H)
      }

      // ── 3. Labels ────────────────────────────────────────────────────────
      drawLabels(ctx, geo, now)

      // ── 4. Pacing circle ─────────────────────────────────────────────────
      {
        const pacingPos = startedRef.current
          ? getPacing(now - gameStartRef.current)
          : { x: startPt.x, y: startPt.y }
        if (pacingPos) {
          pacingPosRef.current = pacingPos
          const px   = pacingPos.x
          const py   = pacingPos.y
          const pRad = lw * 0.62
          ctx.beginPath()
          ctx.arc(px, py, pRad, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fill()
        }
      }

      // ── 5. Amber circle ──────────────────────────────────────────────────
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

      // ── 6. Encouragement moment ──────────────────────────────────────────
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
  }, [])

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <button
        onClick={handleExit}
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30 transition-colors"
        aria-label="Exit game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

      {!showIntro && (
        <StrokeSelector
          activeStroke={activeStroke}
          onSelect={handleStrokeSelect}
        />
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none', pointerEvents: showIntro ? 'none' : 'auto' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      />

      {showIntro && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: overlayColor, opacity: overlayOpacity }}
        />
      )}

      {showIntro && (
        <IntroScreen onSkip={skipIntro} textRef={textRef} line1Ref={line1Ref} line2Ref={line2Ref} />
      )}

      {/* Headless — mounts the stroke module orchestrator so squareCanvasRef is populated */}
      <SquareCanvas ref={squareCanvasRef} strokeModeRef={strokeModeRef} />
    </div>
  )
}