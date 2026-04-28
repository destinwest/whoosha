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
import * as stampStroke   from './strokes/stampStroke'
import * as layeredWash   from './strokes/layeredWash'

// ── Constants ─────────────────────────────────────────────────────────────────
const LAP_COLORS   = ['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7']
const CYCLE_MS     = 16_000

// ── Heat gauge tuning ─────────────────────────────────────────────────────────
const GAUGE_SPEED_THRESHOLD   = 1.2   // path rate ratio above which gauge charges
const GAUGE_RECOVER_THRESHOLD = 3.0   // path rate ratio above which recovery timer resets — only true racing blocks recovery
const GAUGE_CHARGE_DELAY      = 4000  // ms of sustained too-fast before desaturation begins
const GAUGE_DRAIN_DELAY       = 1000  // ms of sustained recoverable-pace before recovery begins
const GAUGE_EFFECT_THRESHOLD = 0.3    // gauge value below which no visible effect appears
const ALPHA_ACTIVE = 0.75
const ALPHA_FLOOR  = 0.18
const SCALE_ACTIVE = 1.5
const BLEND_MS     = 600

const smoothstep   = t => t * t * (3 - 2 * t)
const easeIn       = t => t * t * t
const easeOutSoft  = t => 1 - Math.pow(1 - t, 2)

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

  const labelMids = straightFrom.map((a, i) => ({
    x: (a.x + straightTo[i].x) / 2,
    y: (a.y + straightTo[i].y) / 2,
  }))

  let totalPathLength = 0
  for (let i = 0; i < N; i++) {
    totalPathLength += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }

  return {
    cx, cy, sq, half, lw, r, sf,
    arcCenters, arcStartAngles,
    straightFrom, straightTo,
    points, labelMids,
    totalPathLength,
    w, h,
  }
}

// ── buildBgGradient ───────────────────────────────────────────────────────────
// Computed once per resize, cached in bgGradientRef. W, H in CSS px.
function buildBgGradient(ctx, W, H) {
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#B0CECA')   // top-left — lighter, cooler sage
  grad.addColorStop(1, '#7A9E99')   // bottom-right — darker, warmer sage
  return grad
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
  const cx = left + sqW / 2
  const cy = top  + sqW / 2

  // innerR = inner edge of the straight sides (closest track surface to center).
  // outerR = beyond corner outer edges (~sqW*0.70 from center) so corners
  // fall within the gradient range and are not clamped to the darkest stop.
  const innerR = sqW / 2 - lw / 2
  const outerR = sqW * 0.75

  // Position stops so the transition spans from straight inner edge (t=0)
  // through straight outer edge (~t=0.46) to corner outer edges (~t=0.88).
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
  grad.addColorStop(0,   '#FAF5EE')   // inner edge of straights — lightest
  grad.addColorStop(0.4, '#F5EFE6')   // straight outer edge — base cream
  grad.addColorStop(1,   '#EDE5D8')   // corner outer edges — darkest
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
    left + lw * 0.5,
    top  + lw * 0.5,
    sqW  - lw,
    sqW  - lw,
    cr   - lw * 0.5,
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
  { strokeModeRef, onTick, onGameStart, onResize, interactive },
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
  const bgGradientRef    = useRef(null)   // cached background gradient (rebuilt on resize)

  // ── Game state refs ────────────────────────────────────────────────────────
  const pacingStartRef       = useRef(null)    // clock for pacing circle — starts at mount
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
  const lastMoveTimeRef      = useRef(0)
  const fpImgRef             = useRef(null)    // loaded Image object
  const fpImgReadyRef        = useRef(false)   // true once image has loaded
  const fingerprintActiveRef = useRef(true)             // true until first touch
  const fpDismissTRef        = useRef(0)                // 0→1, dismiss progress
  const fpDismissingRef      = useRef(false)            // true during dismiss animation
  const touchActiveRef       = useRef(false)            // true while finger is down
  const lastTouchRef         = useRef({ x: 0, y: 0 })  // last clamped touch position
  const bloomFadeRef         = useRef(1)                // bloom opacity: 1=full, 0=gone
  const bloomFadingRef       = useRef(false)            // true during post-lift fade
  const bloomAttackRef       = useRef(0)                // 0→1 over attack duration, resets on touch
  const paintPressureRef     = useRef(0)                // 0→1, ramps up on each new touch
  const particlesRef         = useRef([])               // active particle objects
  const particleFrameRef     = useRef(0)                // frame counter for emission throttle
  const lastTouchTimeRef     = useRef(0)                // timestamp of last pointermove
  const fingerSpeedRef       = useRef(0)                // px/ms, smoothed finger speed
  const trackTangentRef      = useRef({ x: 1, y: 0 })  // unit vector along track at touch point
  const dismissRafRef        = useRef(null)             // RAF handle for dismiss tick
  const bloomFadeRafRef      = useRef(null)             // RAF handle for bloom fade tick
  const bloomAttackRafRef    = useRef(null)             // RAF handle for bloom attack tick
  const paintPressureRafRef  = useRef(null)             // RAF handle for paint pressure ramp

  // ── Heat gauge ────────────────────────────────────────────────────────────
  const heatGaugeRef         = useRef(0)     // 0.0–1.0, invisible gauge
  const tooFastTimerRef      = useRef(0)     // ms accumulated above speed threshold
  const goodPaceTimerRef     = useRef(0)     // ms accumulated at or below speed threshold
  const gaugeActiveRef       = useRef(false) // true once desaturation has fully fired
  const gaugeEffectRef       = useRef(0)     // computed gFx, written by gauge block, read by draw loop
  const childPathRateRef     = useRef(0)     // path fraction-units/ms, smoothed

  // ── Fingerprint image loader ────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      fpImgRef.current      = img
      fpImgReadyRef.current = true
    }
    img.src = '/assets/fingerprint.png'
  }, [])

  // ── Imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    reset() {
      // Clear canvas content — stampStroke.clear() wipes via canvas.width
      // reassignment (destroying the clip), so we reapply it immediately.
      stampStroke.clear()
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
      pacingStartRef.current       = performance.now()
      lapColorIdxRef.current       = 0
      lastEncouragementRef.current = -Infinity
      encouragementRef.current     = null

      // Restore fingerprint; clear bloom
      fingerprintActiveRef.current = true
      fpDismissTRef.current        = 0
      fpDismissingRef.current      = false
      touchActiveRef.current       = false
      bloomFadeRef.current         = 1
      bloomFadingRef.current       = false
      lastTouchRef.current         = { x: 0, y: 0 }
      bloomAttackRef.current       = 0
      paintPressureRef.current     = 0
      particlesRef.current         = []
      particleFrameRef.current     = 0
      fingerSpeedRef.current       = 0
      cancelAnimationFrame(dismissRafRef.current)
      cancelAnimationFrame(bloomFadeRafRef.current)
      cancelAnimationFrame(bloomAttackRafRef.current)
      cancelAnimationFrame(paintPressureRafRef.current)

      heatGaugeRef.current        = 0
      tooFastTimerRef.current     = 0
      goodPaceTimerRef.current    = 0
      gaugeActiveRef.current      = false
      gaugeEffectRef.current      = 0
      childPathRateRef.current    = 0
      document.documentElement.style.setProperty('--game-saturation', '1')
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

  // ── Project finger onto path ───────────────────────────────────────────────
  // Returns the nearest centerline point plus fraction. Returns null if the
  // touch is outside the acceptance zone (lw * 0.75 from centerline).
  function project(px, py) {
    const geo = geoRef.current
    if (!geo) return null
    const { points, lw } = geo
    const N    = points.length - 1
    let   best = { dist: Infinity, x: 0, y: 0, fraction: 0 }

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
        best = { dist: d, x: nx, y: ny, fraction: (i + t) / N * 4 }
      }
    }

    // Reject touches outside the track acceptance zone
    if (best.dist > lw * 0.75) return null

    return {
      dist:     best.dist,
      x:        best.x,
      y:        best.y,
      clx:      best.x,
      cly:      best.y,
      fraction: best.fraction,
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
    if (gaugeActiveRef.current) return  // floor reached — no paint until recovery completes
    if (strokeModeRef.current === 'watercolor') {
      layeredWash.addPoint(x, y, vel)
    } else {
      stampStroke.addPoint(x, y, vel, paintPressureRef.current)
    }
  }

  // ── Paint pressure ramp ────────────────────────────────────────────────────
  // Called on every pointerdown. Resets pressure to 0 and ramps to 1 over 100ms.
  function startPressureRamp() {
    paintPressureRef.current = 0
    cancelAnimationFrame(paintPressureRafRef.current)
    const pressureStart = performance.now()
    function pressureTick(now) {
      const t = Math.min(1, (now - pressureStart) / 100)
      paintPressureRef.current = easeOutSoft(t)
      if (t < 1) paintPressureRafRef.current = requestAnimationFrame(pressureTick)
      else paintPressureRef.current = 1
    }
    paintPressureRafRef.current = requestAnimationFrame(pressureTick)
  }

  // ── Bloom attack ramp ──────────────────────────────────────────────────────
  // Called on every pointerdown. Ramps bloomAttackRef from 0 to 1 over 180ms.
  function startBloomAttack() {
    bloomAttackRef.current = 0
    cancelAnimationFrame(bloomAttackRafRef.current)
    const attackStart = performance.now()
    function attackTick(ts) {
      const t = Math.min(1, (ts - attackStart) / 180)
      bloomAttackRef.current = easeOutSoft(t)
      if (t < 1) bloomAttackRafRef.current = requestAnimationFrame(attackTick)
      else bloomAttackRef.current = 1
    }
    bloomAttackRafRef.current = requestAnimationFrame(attackTick)
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function onPointerDown(px, py) {
    if (!geoRef.current) return

    const pos = project(px, py)
    if (!pos) return   // outside acceptance zone — silent rejection

    if (!startedRef.current) {
      startedRef.current      = true
      gameStartRef.current    = performance.now()
      touchRef.current        = true
      lastMoveTimeRef.current = performance.now()
      onGameStart?.()
      childPosRef.current  = pos
      lastChildPos.current = pos
      prevFracRef.current  = pos.fraction
      addStrokePoint(pos.clx, pos.cly, 0)
      startPressureRamp()

      fingerprintActiveRef.current = false
      fpDismissingRef.current      = true
      fpDismissTRef.current        = 0
      touchActiveRef.current       = true
      lastTouchRef.current         = { x: pos.x, y: pos.y }

      startBloomAttack()

      cancelAnimationFrame(dismissRafRef.current)
      const dismissStart = performance.now()
      function dismissTick(ts) {
        const t = Math.min(1, (ts - dismissStart) / 400)
        fpDismissTRef.current = easeIn(t)
        if (t < 1) {
          dismissRafRef.current = requestAnimationFrame(dismissTick)
        } else {
          fpDismissingRef.current = false
          fpDismissTRef.current   = 1
        }
      }
      dismissRafRef.current = requestAnimationFrame(dismissTick)

    } else {
      touchRef.current        = true
      lastMoveTimeRef.current = performance.now()
      childPosRef.current     = pos
      lastChildPos.current    = pos
      prevFracRef.current     = pos.fraction
      addStrokePoint(pos.clx, pos.cly, 0)
      startPressureRamp()

      touchActiveRef.current = true
      bloomFadingRef.current = false
      bloomFadeRef.current   = 1
      cancelAnimationFrame(bloomFadeRafRef.current)
      lastTouchRef.current   = { x: pos.x, y: pos.y }

      startBloomAttack()
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

    const prevFrac = prevFracRef.current  // capture before checkLap overwrites it

    const pos = project(px, py)
    childPosRef.current  = pos
    lastChildPos.current = pos
    checkLap(pos)

    if (pos && prevFrac !== null && dt > 0) {
      let dfrac = pos.fraction - prevFrac
      if (dfrac < -2) dfrac += 4   // forward lap wrap
      if (dfrac >= 0) {
        childPathRateRef.current = childPathRateRef.current * 0.5 + (dfrac / dt) * 0.5
      }
    }

    if (pos) {
      const color = getLapColor(pos.fraction)
      stampStroke.updateColor(color, lapColorIdxRef.current)
      layeredWash.updateColor(color, lapColorIdxRef.current)
      addStrokePoint(pos.clx, pos.cly, vel)

      // Speed + tangent — capture prev before overwriting
      const prevTouch = lastTouchRef.current
      lastTouchRef.current = { x: pos.x, y: pos.y }

      const moveDt = now - lastTouchTimeRef.current
      if (moveDt > 0 && moveDt < 100) {
        const dx = pos.x - prevTouch.x
        const dy = pos.y - prevTouch.y
        const rawSpeed = Math.hypot(dx, dy) / moveDt
        fingerSpeedRef.current = fingerSpeedRef.current * 0.7 + rawSpeed * 0.3
        const len = Math.hypot(dx, dy)
        if (len > 0.5) trackTangentRef.current = { x: dx / len, y: dy / len }
      }
      lastTouchTimeRef.current = now
    }
  }

  function onPointerUp() {
    touchRef.current         = false
    touchActiveRef.current   = false
    particleFrameRef.current = 0
    childPathRateRef.current = 0
    stampStroke.lift()
    layeredWash.lift()

    // Start bloom fade
    if (!startedRef.current) return
    bloomFadeRef.current   = 1
    bloomFadingRef.current = true
    cancelAnimationFrame(bloomFadeRafRef.current)
    const fadeStart = performance.now()
    function bloomFadeTick(ts) {
      const t = Math.min(1, (ts - fadeStart) / 900)
      bloomFadeRef.current = easeOutSoft(1 - t)
      if (t < 1) {
        bloomFadeRafRef.current = requestAnimationFrame(bloomFadeTick)
      } else {
        bloomFadeRef.current   = 0
        bloomFadingRef.current = false
      }
    }
    bloomFadeRafRef.current = requestAnimationFrame(bloomFadeTick)
  }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

  // ── Particle helpers ───────────────────────────────────────────────────────
  function emitParticle(x, y, moving, lw) {
    const tangent = trackTangentRef.current
    const normal  = { x: -tangent.y, y: tangent.x }

    let vx, vy
    if (moving) {
      const speed       = 0.04 + Math.random() * 0.06
      const tangentBias = (Math.random() - 0.5) * 2
      const normalBias  = (Math.random() - 0.5) * 0.6
      vx = (tangent.x * tangentBias + normal.x * normalBias) * speed
      vy = (tangent.y * tangentBias + normal.y * normalBias) * speed
    } else {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.02 + Math.random() * 0.03
      vx = Math.cos(angle) * speed
      vy = Math.sin(angle) * speed
    }

    const life = moving
      ? 500 + Math.random() * 300
      : 700 + Math.random() * 400

    particlesRef.current.push({ x, y, vx, vy, life, maxLife: life,
      size: lw * (0.04 + Math.random() * 0.04) })

    if (particlesRef.current.length > 40) particlesRef.current.shift()
  }

  function updateAndDrawParticles(ctx, lw, dt) {
    particlesRef.current = particlesRef.current.filter(p => p.life > 0)

    for (const p of particlesRef.current) {
      p.x    += p.vx * dt
      p.y    += p.vy * dt
      p.life -= dt
      p.vy   -= 0.0002

      const lifeT          = p.life / p.maxLife
      const particleAlpha  = Math.min(1, lifeT * 3) * lifeT
      if (particleAlpha < 0.01) continue

      const radius = p.size * (0.6 + lifeT * 0.4)
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
      g.addColorStop(0,   `rgba(255,220,140,${(particleAlpha * 0.9).toFixed(3)})`)
      g.addColorStop(0.5, `rgba(212,160,86,${(particleAlpha * 0.5).toFixed(3)})`)
      g.addColorStop(1,   'rgba(212,160,86,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
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
      const rect     = { width: canvas.offsetWidth, height: canvas.offsetHeight }
      if (rect.width === 0 || rect.height === 0) return
      if (rect.width === lastW && rect.height === lastH) return
      lastW = rect.width
      lastH = rect.height

      canvas.width       = rect.width  * dpr
      canvas.height      = rect.height * dpr
      paintCanvas.width  = rect.width  * dpr
      paintCanvas.height = rect.height * dpr
      geoRef.current     = buildGeo(rect)
      onResize?.({ labelMids: geoRef.current.labelMids, sq: geoRef.current.sq })

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
      bgGradientRef.current    = buildBgGradient(ctx, rect.width, rect.height)

      const idx   = lapColorIdxRef.current
      const color = lerpColor(
        LAP_COLORS[idx       % LAP_COLORS.length],
        LAP_COLORS[(idx + 1) % LAP_COLORS.length],
        0,
      )
      stampStroke.init({ paintCtx, lw, dpr, color, lapColorIdx: idx })
      layeredWash.init({ paintCtx, lw, dpr, color, lapColorIdx: idx, clipArgs })
    }

    pacingStartRef.current = performance.now()
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let prevFrameTime = 0

    function frame() {
      rafRef.current = requestAnimationFrame(frame)

      const geo = geoRef.current
      if (!geo) return

      const now = performance.now()
      const dt  = prevFrameTime > 0 ? Math.min(now - prevFrameTime, 50) : 16.67
      prevFrameTime = now
      onTick?.(now)

      const dpr = dprRef.current
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { cx, cy, sq, half, lw, r } = geo

      // ── Heat gauge effect — written by gauge block each frame, read here ────
      const gaugeEffect = gaugeEffectRef.current

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 0. Background fill ────────────────────────────────────────────────
      ctx.fillStyle = bgGradientRef.current ?? '#9FBFB4'
      ctx.fillRect(0, 0, W, H)

      // ── 0b. Background vignette ───────────────────────────────────────────
      drawVignette(ctx, W, H)

      // ── 1. Racetrack — four passes ────────────────────────────────────────
      const trackGeo = trackGeoRef.current
      if (trackGeo) {
        drawTrackShadow(ctx, trackGeo)
        drawTrackBody(ctx, trackGeo, trackGradientRef.current)
        // drawTrackHighlight(ctx, trackGeo)
        drawTrackInnerWall(ctx, trackGeo)
      }

      // ── 2. Paint layer ────────────────────────────────────────────────────
      // source-over composites the paint above the track. globalAlpha drains
      // as heat gauge climbs — paint fades from the track surface.
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      if (strokeModeRef.current === 'watercolor') {
        ctx.globalAlpha = 1 - gaugeEffect
        const wLayers = layeredWash.getLayers()
        for (const { canvas: lc } of wLayers) {
          ctx.drawImage(lc, 0, 0, W, H)
        }
      } else {
        ctx.globalAlpha = stampStroke.COMPOSITE_ALPHA * (1 - gaugeEffect)
        ctx.drawImage(paintCanvas, 0, 0, W, H)
      }
      ctx.restore()

      // ── Pacing position (computed once, shared by fingerprint + pacing circle) ─
      // Pacing starts at mount — independent of first touch.
      const pacingPos = getPacing(now - pacingStartRef.current)
      if (pacingPos) pacingPosRef.current = pacingPos

      // ── Heat gauge update ─────────────────────────────────────────────────
      if (startedRef.current) {
        // ── Speed ratio ────────────────────────────────────────────────────
        // Pacing rate is constant — 4 fraction-units per lap per CYCLE_MS.
        const pacingRate = 4 / CYCLE_MS
        const speedRatio = childPathRateRef.current / pacingRate

        const isTooFast  = touchRef.current && speedRatio > GAUGE_SPEED_THRESHOLD
        const isGoodPace = !touchRef.current || speedRatio <= GAUGE_SPEED_THRESHOLD

        // ── Charge timer — 1.2× threshold ─────────────────────────────────
        if (isTooFast) {
          tooFastTimerRef.current = Math.min(GAUGE_CHARGE_DELAY, tooFastTimerRef.current + dt)
        } else if (isGoodPace && !gaugeActiveRef.current) {
          // Slowing before floor — slowly decay the charge timer
          tooFastTimerRef.current = Math.max(0, tooFastTimerRef.current - dt * 0.5)
        }

        // ── Recovery timer — 3× threshold ─────────────────────────────────
        // Only genuinely racing (> 3× pacing) resets recovery. Normal variation
        // and moderate speed above 1.2× doesn't block the recovery window.
        const isTrulyRacing = touchRef.current && speedRatio > GAUGE_RECOVER_THRESHOLD
        if (isTrulyRacing) {
          goodPaceTimerRef.current = 0
        } else {
          goodPaceTimerRef.current = Math.min(GAUGE_DRAIN_DELAY, goodPaceTimerRef.current + dt)
        }

        // ── Gauge state transitions ────────────────────────────────────────
        if (isTooFast && !gaugeActiveRef.current && tooFastTimerRef.current >= GAUGE_CHARGE_DELAY) {
          // Charge delay met, still racing — ramp gauge to 1 over 2s
          heatGaugeRef.current = Math.min(1, heatGaugeRef.current + dt / 4000)
          if (heatGaugeRef.current >= 1) {
            // Floor reached — clear paint canvas permanently
            gaugeActiveRef.current = true
            stampStroke.clear()
            if (paintCtxRef.current && clipArgsRef.current) {
              applyPaintClip(paintCtxRef.current, clipArgsRef.current)
            }
          }
        } else if (isGoodPace && !gaugeActiveRef.current && heatGaugeRef.current > 0) {
          // Slowing/lifting before floor — drain gauge back over 2s, paint recovers
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 4000)
        } else if (gaugeActiveRef.current && goodPaceTimerRef.current >= GAUGE_DRAIN_DELAY) {
          // Floor reached; good pace held for 1s — drain over 2s, only saturation returns
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 4000)
          if (heatGaugeRef.current <= 0) {
            gaugeActiveRef.current   = false
            goodPaceTimerRef.current = 0
            // tooFastTimerRef stays at GAUGE_CHARGE_DELAY — re-racing re-triggers immediately
          }
        }

        heatGaugeRef.current = Math.max(0, Math.min(1, heatGaugeRef.current))

        // ── Apply effects ──────────────────────────────────────────────────
        const g   = heatGaugeRef.current
        const gFx = g < GAUGE_EFFECT_THRESHOLD
          ? 0
          : Math.pow((g - GAUGE_EFFECT_THRESHOLD) / (1 - GAUGE_EFFECT_THRESHOLD), 2)

        gaugeEffectRef.current = gFx
        document.documentElement.style.setProperty('--game-saturation', (1 - gFx * 0.55).toFixed(3))
      }

      // ── 3. Touch bloom ────────────────────────────────────────────────────
      {
        const showBloom = touchActiveRef.current || bloomFadingRef.current || fpDismissingRef.current
        if (showBloom) {
          const { x: tx, y: ty } = lastTouchRef.current
          const bloomScale = fpDismissingRef.current ? fpDismissTRef.current : 1
          const alpha      = bloomAttackRef.current * bloomFadeRef.current

          const innerR = lw * 0.4 * bloomScale
          const outerR = lw * 1.1 * bloomScale

          if (innerR > 0.5) {
            const inner = ctx.createRadialGradient(tx, ty, 0, tx, ty, innerR)
            inner.addColorStop(0,    `rgba(255,230,160,${(0.85 * alpha).toFixed(3)})`)
            inner.addColorStop(0.15, `rgba(255,210,120,${(0.65 * alpha).toFixed(3)})`)
            inner.addColorStop(0.45, `rgba(212,160,86,${(0.25 * alpha).toFixed(3)})`)
            inner.addColorStop(1,    'rgba(212,160,86,0)')
            ctx.fillStyle = inner
            ctx.beginPath()
            ctx.arc(tx, ty, innerR, 0, Math.PI * 2)
            ctx.fill()
          }

          if (outerR > 0.5) {
            const outer = ctx.createRadialGradient(tx, ty, innerR * 0.5, tx, ty, outerR)
            outer.addColorStop(0,    `rgba(212,160,86,${(0.18 * alpha).toFixed(3)})`)
            outer.addColorStop(0.25, `rgba(212,160,86,${(0.10 * alpha).toFixed(3)})`)
            outer.addColorStop(0.6,  `rgba(212,160,86,${(0.04 * alpha).toFixed(3)})`)
            outer.addColorStop(1,    'rgba(212,160,86,0)')
            ctx.fillStyle = outer
            ctx.beginPath()
            ctx.arc(tx, ty, outerR, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      // ── 4. Particles ──────────────────────────────────────────────────────
      if (startedRef.current) {
        // Decay speed toward zero when finger is still
        if (touchActiveRef.current && now - lastTouchTimeRef.current > 80) {
          fingerSpeedRef.current   *= 0.85
          childPathRateRef.current *= 0.85
        }

        // Emit while finger is down
        if (touchActiveRef.current) {
          particleFrameRef.current++
          const moving       = fingerSpeedRef.current > 0.08
          const emitInterval = moving ? 2 : 4
          if (particleFrameRef.current % emitInterval === 0) {
            emitParticle(lastTouchRef.current.x, lastTouchRef.current.y, moving, lw)
          }
        }

        // Update + draw all living particles (even after lift)
        if (particlesRef.current.length > 0) {
          updateAndDrawParticles(ctx, lw, dt)
        }
      }

      // ── 5. Pacing circle ─────────────────────────────────────────────────────
      if (pacingPos) {
        ctx.beginPath()
        ctx.arc(pacingPos.x, pacingPos.y, lw * 0.62, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fill()
      }

      // ── 6. Fingerprint indicator (above pacing circle) ────────────────────
      if (fpImgReadyRef.current && pacingPos && (fingerprintActiveRef.current || fpDismissingRef.current)) {
        const { x, y } = pacingPos
        const baseR    = lw * 0.45
        const dismissT = fpDismissTRef.current
        const fpR      = baseR * (1 - dismissT)
        const pulse    = 0.85 + 0.15 * Math.sin(now / 1000 * Math.PI)
        const alpha    = pulse * (1 - dismissT)

        if (fpR > 0.5 && alpha > 0.01) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, fpR * 1.6)
          glow.addColorStop(0, `rgba(212,160,86,${(0.22 * (1 - dismissT)).toFixed(3)})`)
          glow.addColorStop(1, 'rgba(212,160,86,0)')
          ctx.beginPath()
          ctx.arc(x, y, fpR * 1.6, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()

          ctx.globalAlpha = alpha
          ctx.drawImage(fpImgRef.current, x - fpR, y - fpR, fpR * 2, fpR * 2)
          ctx.globalAlpha = 1
        }
      }

      // ── 7. Encouragement moment ───────────────────────────────────────────
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

      // ── Label proximity — write CSS vars for DOM overlay ──────────────────
      {
        const { sf } = geo
        const lpFrac  = (((now - pacingStartRef.current) % CYCLE_MS) / CYCLE_MS) * 4
        const lpBlend = smoothstep(startedRef.current
          ? Math.min(1, (now - gameStartRef.current) / BLEND_MS)
          : 0)

        for (let i = 0; i < 4; i++) {
          const localFrac = ((lpFrac - i) % 4 + 4) % 4
          let proximity
          if (localFrac >= 3 + sf) {
            proximity = smoothstep((localFrac - (3 + sf)) / (1 - sf))
          } else if (localFrac <= sf / 1.5) {
            proximity = 1
          } else if (localFrac <= sf) {
            proximity = smoothstep(1 - (localFrac - sf / 1.5) / (sf - sf / 1.5))
          } else {
            proximity = 0
          }
          const alphaProx = ALPHA_FLOOR + (ALPHA_ACTIVE - ALPHA_FLOOR) * proximity
          const scaleProx = 1.0 + (SCALE_ACTIVE - 1.0) * proximity
          const alpha     = ALPHA_ACTIVE + (alphaProx - ALPHA_ACTIVE) * lpBlend
          const scale     = 1.0 + (scaleProx - 1.0) * lpBlend
          document.documentElement.style.setProperty(`--label-${i}-alpha`, alpha.toFixed(3))
          document.documentElement.style.setProperty(`--label-${i}-scale`, scale.toFixed(3))
        }
      }
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      cancelAnimationFrame(dismissRafRef.current)
      cancelAnimationFrame(bloomFadeRafRef.current)
      cancelAnimationFrame(bloomAttackRafRef.current)
      cancelAnimationFrame(paintPressureRafRef.current)
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
