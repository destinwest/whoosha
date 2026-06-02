// ── SquareCanvas.jsx ──────────────────────────────────────────────────────────
// Canvas drawing component — renders the game canvas, owns the rAF loop,
// all geometry computation, all per-frame drawing, and all pointer handling.
//
// Props:
//   strokeModeRef       — { current: 'classic' | 'watercolor' }
//   onTick(now)         — called each rAF frame; SquareGame drives intro from here
//   onGameStart()       — called once when the child first drags from the start point
//   onGameStateTick(s)  — called each rAF frame at end-of-frame, with a snapshot
//                         { gaugeEffect, gaugeActive, synergyStage, breathPhase, speedRatio }
//                         consumed by the sound director for adaptive audio modulation
//   interactive         — boolean; controls pointer events on the canvas element
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

// Initial pacing position when the game opens, expressed as a fraction of
// the 16s breath cycle (0.0 = bottom-left corner, start of breathe-in;
// 0.25 = start of right-hold; 0.5 = start of breathe-out; 0.75 = start of
// left-hold).
//
// 0.75 places the circle at the top of the left edge — just past the
// top-left corner, having "just exited" the breathe-out side. The user
// then gets ~4 s of left-hold (during which the audio is intentionally
// silent — both inhale and exhale windows are closed) to orient and place
// a finger, before the breath cycle's first inhale audio fires.
const START_AT_BREATH_PHASE = 0.75

// Time for one full LAP_COLORS cycle in ms of active tracing.
// 72 000ms = ~72 seconds — roughly four laps at pacing speed.
const COLOR_CYCLE_MS = 72_000

// Maximum path advancement per pointer event — prevents corner-cut visual gaps.
// Expressed as a multiplier of lw; 0.5 = half a track width of path per event.
// At normal tracing speed and 60fps this cap is never reached.
const MAX_PATH_ADVANCE_MULT = 0.5

// ── Heat gauge tuning ─────────────────────────────────────────────────────────
const GAUGE_SPEED_THRESHOLD   = 1.2   // path rate ratio above which gauge charges
const GAUGE_RECOVER_THRESHOLD = 3.0   // path rate ratio above which recovery timer resets — only true racing blocks recovery
const GAUGE_CHARGE_DELAY      = 500   // ms of sustained too-fast before the gauge starts ramping
const GAUGE_DRAIN_DELAY       = 250   // ms of sustained recoverable-pace before recovery begins
const GAUGE_EFFECT_THRESHOLD = 0.3    // gauge value below which no visible effect appears

// ── Synergy tuning ────────────────────────────────────────────────────────────
// Time-based continuous reward. An on-pace accumulator grows while the user
// stays close + in pace and decays when they drift. Stage 0→4 is mapped
// directly from the accumulator via piecewise-linear thresholds.
const SYNERGY_DIST_THRESHOLD_LW = 0.8     // user within lw * 0.8 of pacing counts as close
const SYNERGY_TIME_0_TO_1_MS    = 4000    // 0 → Stage 1 — amber grows to pacing size
const SYNERGY_TIME_1_TO_2_MS    = 4000    // Stage 1 → 2 — pacing fill shifts to amber
const SYNERGY_TIME_2_TO_3_MS    = 8000    // Stage 2 → 3 — both circles grow to 1.5×
const SYNERGY_TIME_3_TO_4_MS    = 16000   // Stage 3 → 4 — embers begin radiating
const SYNERGY_MAX_ACCUM_MS      = SYNERGY_TIME_0_TO_1_MS + SYNERGY_TIME_1_TO_2_MS
                                + SYNERGY_TIME_2_TO_3_MS + SYNERGY_TIME_3_TO_4_MS  // 32s
const SYNERGY_MAX_STAGE         = 4
const SYNERGY_RETURN_MS         = 3000                                  // full return-to-start duration from max state
const SYNERGY_RETURN_RATE       = SYNERGY_MAX_ACCUM_MS / SYNERGY_RETURN_MS  // accum-ms drained per real-ms during return
const EMBER_PARTICLE_CAP        = 30
const EMBER_SPAWN_RATE_AT_FULL  = 14      // particles per second at Stage 4.0
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
  grad.addColorStop(0,   '#FAF2E0')   // inner edge of straights — lightest honey-cream
  grad.addColorStop(0.4, '#F2EAD0')   // straight outer edge — base warm cream
  grad.addColorStop(1,   '#E6DBBF')   // corner outer edges — darkest sand-cream
  return grad
}

// Pass A — outer shadow: bleeds outside track footprint, soft drop shadow.
function drawTrackShadow(ctx, { left, top, sqW, cr, lw }) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(left, top, sqW, sqW, cr)
  ctx.lineWidth   = lw + 7
  ctx.strokeStyle = 'rgba(78,68,40,0.22)'
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
  ctx.strokeStyle = 'rgba(78,68,40,0.14)'
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
  { strokeModeRef, pacingCanvasRef, onTick, onGameStart, onGameStateTick, onResize, interactive },
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
  const trackTextureImgRef = useRef(null) // dirt-path SVG image, loaded once on mount
  const trackPatternRef    = useRef(null) // CanvasPattern derived from texture image

  // ── Game state refs ────────────────────────────────────────────────────────
  const pacingStartRef       = useRef(null)    // clock for pacing circle — starts at mount
  const gameStartRef         = useRef(null)
  const startedRef           = useRef(false)
  const touchRef             = useRef(false)
  const childPosRef          = useRef(null)
  const lastChildPos         = useRef(null)
  const lapCountRef          = useRef(0)   // laps completed — used only for encouragement gate
  const colorTimeRef         = useRef(0)   // ms of active tracing time — drives color drift
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
  const pacingEmphasisRef    = useRef(0)     // 0–1, eased toward gaugeActive — drives pacing-circle grow + glow
  // ── Synergy reward (time-based continuous progression) ────────────────────
  const synergyStageRef      = useRef(0)     // 0.0 → 4.0, derived from accumulator each frame
  const onPaceAccumRef       = useRef(0)     // ms of on-pace time, caps at SYNERGY_MAX_ACCUM_MS
  const emberParticlesRef    = useRef([])    // pooled ember particles (Stage 4)
  const lastEmberSpawnRef    = useRef(0)     // ms timestamp of last ember spawn

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
      // See START_AT_BREATH_PHASE — shift the reference time back so elapsed
      // begins at the desired breath-phase fraction rather than at 0.
      pacingStartRef.current       = performance.now() - START_AT_BREATH_PHASE * CYCLE_MS
      lapCountRef.current          = 0
      colorTimeRef.current         = 0
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
      pacingEmphasisRef.current   = 0
      synergyStageRef.current     = 0
      onPaceAccumRef.current      = 0
      emberParticlesRef.current   = []
      lastEmberSpawnRef.current   = 0
      document.documentElement.style.setProperty('--game-saturation', '1')
    },
  }), [])

  // ── Lap color ──────────────────────────────────────────────────────────────
  function getDriftColor(colorTime) {
    const n          = LAP_COLORS.length
    const colorPos   = ((colorTime % COLOR_CYCLE_MS) / COLOR_CYCLE_MS) * n
    const colorIdxA  = Math.floor(colorPos) % n
    const colorIdxB  = (colorIdxA + 1) % n
    const colorBlend = colorPos - Math.floor(colorPos)
    return lerpColor(LAP_COLORS[colorIdxA], LAP_COLORS[colorIdxB], colorBlend)
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

  // ── advanceAlongPath ──────────────────────────────────────────────────────
  // Given a starting fraction on the path (0–4) and a target fraction, return
  // the position that is at most maxDist (CSS px) ahead of the start along the
  // path. If the gap is within maxDist, returns the target unchanged. If it
  // exceeds maxDist, walks forward and returns the capped position and fraction.
  // Handles the wrap-around at fraction 4→0.
  function advanceAlongPath(prevFrac, targetFrac, maxDist, points, totalPathLength) {
    const N = points.length - 1

    function fracToIndex(frac) {
      return Math.round((frac / 4) * N)
    }

    const prevIdx   = fracToIndex(prevFrac)
    const targetIdx = fracToIndex(targetFrac)

    // Handle forward wrap-around: if target appears behind prev in index space
    // but the fraction difference is small and positive, adjust for wrap.
    let idxDiff = targetIdx - prevIdx
    if (idxDiff < -N / 2) idxDiff += N   // wrapped forward
    if (idxDiff < 0) {
      // Child moved backward — allow drift, don't cap forward advancement.
      return { x: points[targetIdx % N].x, y: points[targetIdx % N].y, fraction: targetFrac }
    }

    // Measure actual path distance from prevIdx to targetIdx
    let pathDist = 0
    for (let i = prevIdx; i < prevIdx + idxDiff; i++) {
      const a = points[i % N]
      const b = points[(i + 1) % N]
      pathDist += Math.hypot(b.x - a.x, b.y - a.y)
      if (pathDist >= maxDist) {
        // Hit the cap — return the position at exactly maxDist from prevIdx
        const cappedIdx  = i % N
        const cappedFrac = (cappedIdx / N) * 4
        return { x: points[cappedIdx].x, y: points[cappedIdx].y, fraction: cappedFrac }
      }
    }

    // Gap was within maxDist — return target unchanged
    return { x: points[targetIdx % N].x, y: points[targetIdx % N].y, fraction: targetFrac }
  }

  // ── Lap detection ──────────────────────────────────────────────────────────
  function checkLap(pos) {
    if (!pos) return
    const prev = prevFracRef.current
    if (prev !== null && prev > 3.7 && pos.fraction < 0.3) onLapComplete()
    prevFracRef.current = pos.fraction
  }

  function onLapComplete() {
    lapCountRef.current++
    const now    = performance.now()
    const pacing = pacingPosRef.current
    const child  = childPosRef.current
    if (pacing && child) {
      const dist = Math.hypot(child.clx - pacing.x, child.cly - pacing.y)
      if (lapCountRef.current > 1 && dist <= 60 && now - lastEncouragementRef.current > 30_000) {
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
      const geo        = geoRef.current
      const maxAdvance = geo.lw * MAX_PATH_ADVANCE_MULT

      // Cap path advancement — prevents corner-cut stamp gaps.
      // Uses prevFrac (captured before checkLap overwrote prevFracRef).
      const capped = advanceAlongPath(
        prevFrac,
        pos.fraction,
        maxAdvance,
        geo.points,
        geo.totalPathLength,
      )
      const paintX = capped.x
      const paintY = capped.y

      // Update refs with capped values so the next event caps from here
      childPosRef.current = { x: paintX, y: paintY, clx: paintX, cly: paintY, fraction: capped.fraction }
      prevFracRef.current = capped.fraction

      const color = getDriftColor(colorTimeRef.current)
      stampStroke.updateColor(color)
      layeredWash.updateColor(color)
      addStrokePoint(paintX, paintY, vel)

      // Speed + tangent — capture prev before overwriting
      const prevTouch = lastTouchRef.current
      lastTouchRef.current = { x: paintX, y: paintY }

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

    // Track dirt-path texture — load once, create pattern when ready.
    // First frames render without texture; pattern appears when image resolves.
    const textureImg = new Image()
    textureImg.onload = () => {
      trackTextureImgRef.current = textureImg
      trackPatternRef.current    = ctx.createPattern(textureImg, 'repeat')
    }
    textureImg.src = '/textures/track-dirt.svg'

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

      // Pacing-circle overlay canvas — same dimensions and DPR as main canvas
      const pacingCanvas = pacingCanvasRef?.current
      if (pacingCanvas) {
        pacingCanvas.width  = rect.width  * dpr
        pacingCanvas.height = rect.height * dpr
      }
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

      const color = getDriftColor(colorTimeRef.current)
      stampStroke.init({ paintCtx, lw, dpr, color })
      layeredWash.init({ paintCtx, lw, dpr, color, clipArgs })
    }

    // See START_AT_BREATH_PHASE — same shift as in reset() so the very first
    // game opening starts the pacing at the top-left, not the bottom-left.
    pacingStartRef.current = performance.now() - START_AT_BREATH_PHASE * CYCLE_MS
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

      // ── 2b. Track texture ─────────────────────────────────────────────────
      // Subtle dirt-path texture stroked along the track centerline. Sits above
      // the paint so it reads as the surface character of the track itself —
      // visible through both bare cream and painted color. Pattern image is
      // baked into a GPU texture; per-frame cost is one stroke call.
      const trackPattern = trackPatternRef.current
      if (trackPattern && trackGeo) {
        ctx.save()
        ctx.strokeStyle = trackPattern
        ctx.lineWidth   = trackGeo.lw
        ctx.beginPath()
        ctx.roundRect(trackGeo.left, trackGeo.top, trackGeo.sqW, trackGeo.sqW, trackGeo.cr)
        ctx.stroke()
        ctx.restore()
      }

      // ── Pacing position (computed once, shared by fingerprint + pacing circle) ─
      // Pacing starts at mount — independent of first touch.
      const pacingPos = getPacing(now - pacingStartRef.current)
      if (pacingPos) pacingPosRef.current = pacingPos

      // ── Color drift ───────────────────────────────────────────────────────
      // Advance timer only while finger is on track; compute color every frame
      // so stamps always use the current drifted value.
      if (startedRef.current && touchRef.current) {
        colorTimeRef.current += dt
      }
      if (startedRef.current) {
        const driftColor = getDriftColor(colorTimeRef.current)
        stampStroke.updateColor(driftColor)
        layeredWash.updateColor(driftColor)
      }

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
          heatGaugeRef.current = Math.min(1, heatGaugeRef.current + dt / 2000)
          if (heatGaugeRef.current >= 1) {
            // Floor reached — clear paint canvas permanently. Synergy now
            // drains gracefully via the synergy block (3-second return rate
            // engages while gaugeActiveRef.current is true).
            gaugeActiveRef.current = true
            stampStroke.clear()
            if (paintCtxRef.current && clipArgsRef.current) {
              applyPaintClip(paintCtxRef.current, clipArgsRef.current)
            }
          }
        } else if (isGoodPace && !gaugeActiveRef.current && heatGaugeRef.current > 0) {
          // Slowing/lifting before floor — drain gauge back over 1s, paint recovers
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 1000)
        } else if (gaugeActiveRef.current && goodPaceTimerRef.current >= GAUGE_DRAIN_DELAY) {
          // Floor reached; good pace held for 0.25s — drain over 1s, only saturation returns
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 1000)
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
        // Drain saturation toward grayscale — the color drains from the world.
        document.documentElement.style.setProperty('--game-saturation', (1 - gFx * 0.9).toFixed(3))
      }

      // ── Synergy update ────────────────────────────────────────────────────
      // Three behaviors:
      //   - Finger lifted OR gauge-floor active → fast return to 0 over 3s
      //     (from max). Both events should drain the synergy reward.
      //   - Touching + on-pace               → accumulator grows at +dt.
      //   - Touching + off-pace              → symmetric 1:1 slow decay.
      if (!touchRef.current || gaugeActiveRef.current) {
        onPaceAccumRef.current = Math.max(
          0, onPaceAccumRef.current - dt * SYNERGY_RETURN_RATE,
        )
      } else if (startedRef.current && pacingPos && childPosRef.current) {
        const child      = childPosRef.current
        const dist       = Math.hypot(child.clx - pacingPos.x, child.cly - pacingPos.y)
        const speedRatio = childPathRateRef.current / (4 / CYCLE_MS)
        const close      = dist <= lw * SYNERGY_DIST_THRESHOLD_LW
        const inPace     = speedRatio <= GAUGE_SPEED_THRESHOLD
        if (close && inPace) {
          onPaceAccumRef.current = Math.min(SYNERGY_MAX_ACCUM_MS, onPaceAccumRef.current + dt)
        } else {
          onPaceAccumRef.current = Math.max(0, onPaceAccumRef.current - dt)
        }
      }

      // Map accumulator → continuous stage (piecewise linear)
      {
        const a = onPaceAccumRef.current
        const t1 = SYNERGY_TIME_0_TO_1_MS
        const t2 = t1 + SYNERGY_TIME_1_TO_2_MS
        const t3 = t2 + SYNERGY_TIME_2_TO_3_MS
        const t4 = t3 + SYNERGY_TIME_3_TO_4_MS
        if      (a >= t4) synergyStageRef.current = 4
        else if (a >= t3) synergyStageRef.current = 3 + (a - t3) / SYNERGY_TIME_3_TO_4_MS
        else if (a >= t2) synergyStageRef.current = 2 + (a - t2) / SYNERGY_TIME_2_TO_3_MS
        else if (a >= t1) synergyStageRef.current = 1 + (a - t1) / SYNERGY_TIME_1_TO_2_MS
        else              synergyStageRef.current = a / SYNERGY_TIME_0_TO_1_MS
      }

      // Derived stage values for visual mapping
      const synStage   = synergyStageRef.current
      const synStage01 = Math.min(1, synStage)                       // 0 → 1 across stages 0..1 (amber grows to pacing size)
      const synStage12 = Math.max(0, Math.min(1, synStage - 1))      // 0 → 1 across stages 1..2 (pacing fill shifts to amber)
      const synStage23 = Math.max(0, Math.min(1, synStage - 2))      // 0 → 1 across stages 2..3 (both circles grow to 1.5×)
      const synStage34 = Math.max(0, Math.min(1, synStage - 3))      // 0 → 1 across stages 3..4 (ember particles radiate)

      // ── 3. Touch bloom ────────────────────────────────────────────────────
      {
        const showBloom = touchActiveRef.current || bloomFadingRef.current || fpDismissingRef.current
        if (showBloom) {
          const { x: tx, y: ty } = lastTouchRef.current
          const bloomScale = fpDismissingRef.current ? fpDismissTRef.current : 1
          const alpha      = bloomAttackRef.current * bloomFadeRef.current

          // Stage 0→1 grows the amber bloom toward pacing-circle size;
          // stage 2→3 then grows BOTH circles to 1.5× original pacing size.
          const synergyScale = (1 + 0.55 * synStage01) * (1 + 0.5 * synStage23)
          const innerR = lw * 0.4 * bloomScale * synergyScale
          const outerR = lw * 1.1 * bloomScale * synergyScale

          // One gradient — disk body (0 → 36% of outerR = innerR) + soft halo.
          // The "disk character" emerges with synergy: at synStage01=0 the
          // curve stays soft (subtle pre-synergy bloom); at synStage01=1 the
          // disk reads as solid amber matching the pacing circle's size and
          // opacity. 36% mark is always at innerR (ratio 0.4/1.1 is fixed).
          if (outerR > 0.5) {
            const sb       = synStage01  // 0 → 1: shifts from soft glow to solid disk
            const aMid     = (0.55 + 0.20 * sb) * alpha   // 18% radius
            const aDiskEdge = (0.20 + 0.38 * sb) * alpha  // 36% radius (edge of innerR / "disk edge")
            const aHaloA   = (0.08 + 0.14 * sb) * alpha   // 55% radius
            const aHaloB   = (0.02 + 0.04 * sb) * alpha   // 80% radius

            const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, outerR)
            grad.addColorStop(0,    `rgba(255,230,160,${(0.85 * alpha).toFixed(3)})`)
            grad.addColorStop(0.18, `rgba(255,210,120,${aMid.toFixed(3)})`)
            grad.addColorStop(0.36, `rgba(232,180,100,${aDiskEdge.toFixed(3)})`)
            grad.addColorStop(0.55, `rgba(212,160,86,${aHaloA.toFixed(3)})`)
            grad.addColorStop(0.80, `rgba(212,160,86,${aHaloB.toFixed(3)})`)
            grad.addColorStop(1,    'rgba(212,160,86,0)')
            ctx.fillStyle = grad
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

      // ── 5. Pacing circle — drawn on the separate pacing canvas above the
      //       saturate wrapper. Grows and gains a warm glow when the heat
      //       gauge floor is active, drawing the child's eye back to pace.
      //       Emphasis eases smoothly toward gaugeActive (target 0 or 1) so
      //       the size/glow transition is gentle, not abrupt.
      {
        const target = gaugeActiveRef.current ? 1 : 0
        const k = 1 - Math.exp(-dt / 400)  // exponential ease, ~1.2s to 95%
        pacingEmphasisRef.current += (target - pacingEmphasisRef.current) * k
      }

      const pacingCanvas = pacingCanvasRef?.current
      const pacingCtx = pacingCanvas?.getContext('2d')
      if (pacingCtx) {
        pacingCtx.save()
        pacingCtx.setTransform(1, 0, 0, 1, 0, 0)
        pacingCtx.clearRect(0, 0, pacingCanvas.width, pacingCanvas.height)
        pacingCtx.scale(dpr, dpr)

        if (pacingPos) {
          const emph  = pacingEmphasisRef.current
          const baseR = lw * 0.62
          // Heat-gauge emphasis (1.0→1.2×) and synergy stage 2→3 (1.0→1.5×)
          // both contribute. Mutually exclusive in practice (gauge floor
          // resets synergy), so multiplication doesn't double-stack.
          const r     = baseR * (1 + 0.2 * emph) * (1 + 0.5 * synStage23)

          // Warm glow underneath — vivid amber, brightness scales with emphasis
          if (emph > 0.01) {
            const glowR = r * 1.5
            const glow  = pacingCtx.createRadialGradient(
              pacingPos.x, pacingPos.y, r * 0.5,
              pacingPos.x, pacingPos.y, glowR,
            )
            glow.addColorStop(0, `rgba(255,200,130,${(0.45 * emph).toFixed(3)})`)
            glow.addColorStop(1, 'rgba(255,200,130,0)')
            pacingCtx.beginPath()
            pacingCtx.arc(pacingPos.x, pacingPos.y, glowR, 0, Math.PI * 2)
            pacingCtx.fillStyle = glow
            pacingCtx.fill()
          }

          // The circle itself — translucent so the start-state fingerprint
          // shows through; lifts to more solid at full emphasis (gauge floor).
          // Synergy stage 1→2 lerps the fill from white toward amber #D4A056.
          const fillAlpha = 0.55 + 0.30 * emph
          const fillR = Math.round(255 - 43 * synStage12)
          const fillG = Math.round(255 - 95 * synStage12)
          const fillB = Math.round(255 - 169 * synStage12)
          pacingCtx.beginPath()
          pacingCtx.arc(pacingPos.x, pacingPos.y, r, 0, Math.PI * 2)
          pacingCtx.fillStyle = `rgba(${fillR},${fillG},${fillB},${fillAlpha.toFixed(3)})`
          pacingCtx.fill()
        }

        // ── Ember particles (Stage 3→4) ───────────────────────────────────
        // Crackling embers radiate outward in all directions from the merged
        // pacing/amber center. Short-lived sparks within ~1-2 track-widths.
        if (pacingPos && synStage34 > 0) {
          const spawnInterval = 1000 / (EMBER_SPAWN_RATE_AT_FULL * synStage34)
          if (now - lastEmberSpawnRef.current > spawnInterval) {
            const particles = emberParticlesRef.current
            let slot = particles.find(p => p.life <= 0)
            if (!slot && particles.length < EMBER_PARTICLE_CAP) {
              slot = {}
              particles.push(slot)
            }
            if (slot) {
              const angle = Math.random() * Math.PI * 2
              const speed = 0.05 + Math.random() * 0.02  // 50–70 px/sec
              slot.x       = pacingPos.x + (Math.random() - 0.5) * lw * 0.2
              slot.y       = pacingPos.y + (Math.random() - 0.5) * lw * 0.2
              slot.vx      = Math.cos(angle) * speed
              slot.vy      = Math.sin(angle) * speed
              slot.maxLife = 1000 + Math.random() * 400  // 1000–1400ms — persist out to ~2× pacing radius
              slot.life    = slot.maxLife
            }
            lastEmberSpawnRef.current = now
          }
        }

        // Update + draw embers (continues draining even after spawn stops)
        for (const p of emberParticlesRef.current) {
          if (p.life <= 0) continue
          p.life -= dt
          if (p.life <= 0) continue
          p.x += p.vx * dt
          p.y += p.vy * dt

          const lifeT = p.life / p.maxLife
          const r     = lw * 0.20 * Math.sqrt(lifeT)
          const alpha = lifeT * 0.70  // linear fade — embers stay visible through the full travel
          if (r < 0.5 || alpha < 0.02) continue

          const grad = pacingCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
          grad.addColorStop(0, `rgba(255,210,130,${alpha.toFixed(3)})`)
          grad.addColorStop(1, 'rgba(212,140,60,0)')
          pacingCtx.beginPath()
          pacingCtx.arc(p.x, p.y, r, 0, Math.PI * 2)
          pacingCtx.fillStyle = grad
          pacingCtx.fill()
        }

        pacingCtx.restore()
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

      // ── External state subscription (sound director, etc.) ───────────────
      // Single per-frame snapshot fired after all state has been finalized.
      // Cost: one object allocation per frame; the consumer is expected to
      // be a no-op or cheap modulation. Skipped silently when no observer.
      if (onGameStateTick) {
        const pacingRate = 4 / CYCLE_MS
        onGameStateTick({
          gaugeEffect:  gaugeEffectRef.current,
          gaugeActive:  gaugeActiveRef.current,
          synergyStage: synergyStageRef.current,
          breathPhase:  ((now - pacingStartRef.current) % CYCLE_MS) / CYCLE_MS,
          speedRatio:   childPathRateRef.current / pacingRate,
        })
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
      style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: interactive ? 'auto' : 'none' }}
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
