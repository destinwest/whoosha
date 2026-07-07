// ── InfinityCanvas.jsx ────────────────────────────────────────────────────────
// Canvas drawing component for the Infinity (lazy-8) breathing game. Renders the
// game canvas, owns the rAF loop, all geometry, per-frame drawing, and pointer
// handling. Mirrors SquareCanvas' architecture but on a VERTICAL figure-8
// (lemniscate) path instead of a rounded square.
//
// SCAFFOLD STATE (2026-07-02): this is the first pass — track + groove tracing +
// pacing circle + heat gauge + synergy + fingerprint affordance are live. The
// track is drawn in lavender (it will ultimately be invisible). Deliberately
// deferred until the geometry is locked: the painted finger-trail (needs a
// path-based annular clip for the self-crossing curve), ember/bloom flourishes,
// dirt particles, encouragement messages, and label pulse.
//
// Props / imperative API mirror SquareCanvas (see that file for the full doc).
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { createHeatGauge } from '../_shared/heatGauge'
import { createSynergy }   from '../_shared/synergy'

// ── Breath timing ─────────────────────────────────────────────────────────────
// Lazy-8: one full cycle = inhale (trace the TOP loop) + exhale (trace the
// BOTTOM loop). No holds. Bedtime pace — calm and slow. Equal in/out for now;
// split into unequal durations later (getPacing + pacingRate already localize
// the assumption). CYCLE_MS is derived so the two always agree.
const INHALE_MS = 5_000
const EXHALE_MS = 5_000
const CYCLE_MS  = INHALE_MS + EXHALE_MS

// ── Figure-8 footprint ────────────────────────────────────────────────────────
// The centerline is a vertical lemniscate of Bernoulli. Its raw form has a fixed
// aspect; we scale x and y independently to (a) orient it N–S and (b) fit both
// screen dims. LOBE_ASPECT is the drawn height:width of the whole figure — larger
// = taller/narrower. VFILL/WFILL cap how much of each screen dim it may occupy.
const LOBE_ASPECT = 2.2
const VFILL       = 0.86
const WFILL       = 0.72
const RAW_MAX_RX  = 1 / (2 * Math.SQRT2)   // 0.35355 — max |x| of the raw lemniscate

// ── Tracing core (groove model) ───────────────────────────────────────────────
// Identical semantics to SquareCanvas. The local-arc-length window search in
// projectLocal is what makes the figure-8's center crossover safe: the opposite
// strand is near in pixels but far in arc-length, so it's excluded from the
// search window and the bead can't jump strands.
const LEASH_TRACK_WIDTHS      = 1.4
const ACCEPTANCE_TRACK_WIDTHS = 0.75

// ── Heat gauge tuning ─────────────────────────────────────────────────────────
const GAUGE_SPEED_THRESHOLD = 1.2
const GAUGE_CONFIG = {
  speedThreshold:   GAUGE_SPEED_THRESHOLD,
  recoverThreshold: 3.0,
  chargeDelayMs:    500,
  drainDelayMs:     250,
  rampUpMs:         2000,
  rampDownMs:       1000,
  effectThreshold:  0.3,
}

// ── Synergy tuning ────────────────────────────────────────────────────────────
const SYNERGY_DIST_THRESHOLD_LW = 0.8
const SYNERGY_CONFIG = {
  stageTimesMs: [4000, 4000, 8000, 16000],
  returnMs:     3000,
}

// ── Track rendering ───────────────────────────────────────────────────────────
// The track is now INVISIBLE by design: it still exists as geometry (points +
// cumLen) so it guides the pacing circle and constrains the groove-traced bead,
// but it is no longer drawn. The player follows the pacing circle through the
// "water" and their own trace (ripple stroke — WIP) is the only mark they leave.
//
// SHOW_TRACK is a dev toggle: flip to true to render the lavender placeholder
// band again when debugging geometry (shape, fit, crossover). Colours below are
// only used when SHOW_TRACK is on.
const SHOW_TRACK   = false
const TRACK_BODY   = '#CBBEE8'
const TRACK_SHADOW = 'rgba(40,30,70,0.28)'

// ── Wake (finger through water) ───────────────────────────────────────────────
// Deliberately the ONLY finger effect: a soft, low-contrast wake that trails the
// fingertip and gently heals (fades) behind it, the way calm water closes back
// up after a finger is drawn through it. No lens, no ripple rings, no sparkle —
// this game calms the nervous system, so the mark is a whisper, not a flourish.
//
// The trail is a buffer of recent finger positions; each frame we age + prune it
// and draw it in a few age-bands as a soft cool ribbon, brightest + narrowest at
// the fingertip, spreading + dissolving toward the tail. Source-over (never
// additive), very low alpha. Bounded per-frame: ~2 strokes per band.
const WAKE_LIFE_MS     = 1400   // how long a point lingers before the water "heals"
const WAKE_SPACING_LW  = 0.08   // trail-point spacing along the drag (track-widths)
const WAKE_MAX         = 120    // trail-buffer cap
const WAKE_WIDTH_LW    = 0.42   // base ribbon width (track-widths)
const WAKE_ALPHA       = 0.15   // peak alpha at the fingertip — intentionally faint
const WAKE_COLOR       = '205,210,236'  // soft cool moonlight-lavender

const smoothstep  = t => t * t * (3 - 2 * t)
const easeIn      = t => t * t * t
const easeOutSoft = t => 1 - Math.pow(1 - t, 2)

// ── buildGeo ──────────────────────────────────────────────────────────────────
// Samples the vertical lemniscate into a point array + cumulative arc-lengths.
// Parameter s ∈ [0,1) walks the whole closed path; t = 3π/2 + s·2π so that:
//   s ∈ [0, 0.5)  → TOP loop    (center → top → center)   — INHALE
//   s ∈ [0.5, 1)  → BOTTOM loop (center → bottom → center) — EXHALE
// Starting at the center means each breath phase is exactly one lobe.
function buildGeo(rect) {
  const w  = rect.width
  const h  = rect.height
  const cx = w / 2
  const cy = h / 2

  // Track width — identical to Square/Hexagon: 0.0728 coefficient on the shared
  // size handle min(w,h)·0.78, so lw/circleR match the other games pixel-for-pixel.
  const sizeHandle = Math.min(w, h) * 0.78
  const circleR    = sizeHandle * 0.0728
  const lw         = circleR * 2 + 8

  // Fit a LOBE_ASPECT box within (WFILL·w, VFILL·h), working in centerline
  // extents (drawn extent = centerline + lw). width_c is the centerline width.
  const widthByW = w * WFILL - lw
  const widthByH = (h * VFILL - lw) / LOBE_ASPECT
  const widthC   = Math.max(20, Math.min(widthByW, widthByH))
  const scaleX   = widthC / (2 * RAW_MAX_RX)   // centerline half-width = RAW_MAX_RX·scaleX
  const scaleY   = (LOBE_ASPECT * widthC) / 2  // centerline half-height = scaleY

  const N      = 600
  const points = []
  for (let i = 0; i <= N; i++) {
    const s     = i / N
    const t     = (3 * Math.PI) / 2 + s * 2 * Math.PI
    const ct    = Math.cos(t)
    const st    = Math.sin(t)
    const denom = 1 + st * st
    const rx    = (st * ct) / denom          // raw horizontal, ±RAW_MAX_RX
    const ry    = ct / denom                 // raw vertical, ±1  (+ = up)
    points.push({ x: cx + rx * scaleX, y: cy - ry * scaleY })
  }

  const cumLen = new Array(N + 1)
  cumLen[0] = 0
  for (let i = 0; i < N; i++) {
    cumLen[i + 1] = cumLen[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  const totalPathLength = cumLen[N]

  // Label anchors — vertical middle of each lobe, centered on the axis (sits in
  // the lobe's hole, between the two strands, so text stays clear of the track).
  const labelMids = [
    { x: cx, y: cy - scaleY * 0.5 },   // 0 — top lobe   — "breathe in"
    { x: cx, y: cy + scaleY * 0.5 },   // 1 — bottom lobe — "breathe out"
  ]

  return {
    cx, cy, lw, circleR, sizeHandle,
    scaleX, scaleY,
    points, cumLen, totalPathLength,
    labelMids,
    sides: 2,   // two lobes — fraction runs 0..2 per full cycle
    w, h,
  }
}

// ── Groove tracing core (pure helpers) — shared shape with SquareCanvas ────────
function lerpCumLen(cumLen, idx) {
  const N = cumLen.length - 1
  const i = Math.max(0, Math.min(N - 1, Math.floor(idx)))
  const t = idx - i
  return cumLen[i] + (cumLen[i + 1] - cumLen[i]) * t
}

function arcGapPx(geo, aIdx, bIdx) {
  const { cumLen, totalPathLength } = geo
  const a = lerpCumLen(cumLen, aIdx)
  const b = lerpCumLen(cumLen, bIdx)
  let d = b - a
  if (d >  totalPathLength / 2) d -= totalPathLength
  if (d < -totalPathLength / 2) d += totalPathLength
  return d
}

function fractionAt(geo, idx) {
  const N = geo.points.length - 1
  return (idx / N) * geo.sides
}

// Position at an arc-length fraction f ∈ [0,1) of the whole path (binary search
// on cumLen). Used for the pacing circle so it moves at constant visual speed
// even though points are sampled by parameter, not arc-length.
function pointAtArcFrac(geo, f) {
  const { cumLen, points, totalPathLength } = geo
  const target = f * totalPathLength
  let lo = 0, hi = cumLen.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumLen[mid] < target) lo = mid + 1
    else hi = mid
  }
  const i  = Math.max(1, lo)
  const seg = cumLen[i] - cumLen[i - 1] || 1
  const t  = (target - cumLen[i - 1]) / seg
  const a  = points[i - 1], b = points[i]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// Project onto the path within a local arc-length window (handles self-passing).
function projectLocal(geo, centerIdx, px, py, windowPx) {
  const { points, cumLen, totalPathLength } = geo
  const N = points.length - 1
  const centerLen = lerpCumLen(cumLen, centerIdx)

  let best = null
  for (let i = 0; i < N; i++) {
    let segLen = cumLen[i] - centerLen
    if (segLen >  totalPathLength / 2) segLen -= totalPathLength
    if (segLen < -totalPathLength / 2) segLen += totalPathLength
    if (Math.abs(segLen) > windowPx) continue

    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const lsq = dx * dx + dy * dy
    if (lsq === 0) continue
    const t  = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lsq))
    const nx = a.x + t * dx, ny = a.y + t * dy
    const d  = Math.hypot(px - nx, py - ny)
    if (!best || d < best.perpDist) best = { idx: i + t, x: nx, y: ny, perpDist: d }
  }
  return best
}

// Global nearest projection — first touch, when there's no bead to search around.
function projectGlobal(geo, px, py) {
  const { points } = geo
  const N = points.length - 1
  let best = null
  for (let i = 0; i < N; i++) {
    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const lsq = dx * dx + dy * dy
    if (lsq === 0) continue
    const t  = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lsq))
    const nx = a.x + t * dx, ny = a.y + t * dy
    const d  = Math.hypot(px - nx, py - ny)
    if (!best || d < best.perpDist) best = { idx: i + t, x: nx, y: ny, perpDist: d }
  }
  return best
}

// ── InfinityCanvas ────────────────────────────────────────────────────────────
const InfinityCanvas = forwardRef(function InfinityCanvas(
  { pacingCanvasRef, onTick, onGameStart, onGameStateTick, onResize, interactive },
  ref,
) {
  // ── Canvas infrastructure ──────────────────────────────────────────────────
  const canvasRef      = useRef(null)
  const rafRef         = useRef(null)
  const geoRef         = useRef(null)
  const dprRef         = useRef(window.devicePixelRatio || 1)
  const trackPathRef   = useRef(null)   // Path2D of the centerline (CSS px), rebuilt on resize

  // ── Game state refs ────────────────────────────────────────────────────────
  const pacingStartRef = useRef(null)
  const gameStartRef   = useRef(null)
  const startedRef     = useRef(false)
  const touchRef       = useRef(false)
  const childPosRef    = useRef(null)   // bead pixel pos { x, y, clx, cly, fraction }
  const beadIdxRef     = useRef(null)   // bead as a float index into geo.points
  const fingerPosRef   = useRef(null)
  const tracingRef     = useRef(false)  // bead attached + following this frame
  const prevFracRef    = useRef(null)
  const childPathRateRef = useRef(0)    // fraction-units/ms, smoothed

  // Wake — a buffer of recent finger positions that trails + heals
  const wakeTrailRef   = useRef([])    // [{ x, y, age }] oldest → newest
  const lastWakePtRef  = useRef(null)  // last finger pos a trail point was laid at

  // Fingerprint affordance
  const fpImgRef             = useRef(null)
  const fpImgReadyRef        = useRef(false)
  const fingerprintActiveRef = useRef(true)
  const fpDismissTRef        = useRef(0)
  const fpDismissingRef      = useRef(false)
  const dismissRafRef        = useRef(null)

  // ── Heat gauge ──────────────────────────────────────────────────────────────
  const gaugeMachineRef = useRef(null)
  if (!gaugeMachineRef.current) gaugeMachineRef.current = createHeatGauge(GAUGE_CONFIG)
  const gaugeActiveRef    = useRef(false)
  const gaugeEffectRef    = useRef(0)
  const pacingEmphasisRef = useRef(0)   // eased toward gaugeActive — pacing grow + glow

  // ── Synergy ───────────────────────────────────────────────────────────────
  const synergyMachineRef = useRef(null)
  if (!synergyMachineRef.current) synergyMachineRef.current = createSynergy(SYNERGY_CONFIG)
  const synergyStageRef   = useRef(0)

  // ── Fingerprint image loader ────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image()
    img.onload = () => { fpImgRef.current = img; fpImgReadyRef.current = true }
    img.src = '/assets/fingerprint.png'
  }, [])

  // ── Imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    reset() {
      startedRef.current       = false
      touchRef.current         = false
      childPosRef.current      = null
      beadIdxRef.current       = null
      fingerPosRef.current     = null
      tracingRef.current       = false
      prevFracRef.current      = null
      gameStartRef.current     = null
      pacingStartRef.current   = performance.now()
      childPathRateRef.current = 0

      wakeTrailRef.current     = []
      lastWakePtRef.current    = null

      fingerprintActiveRef.current = true
      fpDismissTRef.current        = 0
      fpDismissingRef.current      = false
      cancelAnimationFrame(dismissRafRef.current)

      gaugeMachineRef.current.reset()
      gaugeActiveRef.current    = false
      gaugeEffectRef.current    = 0
      pacingEmphasisRef.current = 0
      synergyMachineRef.current.reset()
      synergyStageRef.current   = 0
      document.documentElement.style.setProperty('--game-saturation', '1')
    },
  }), [])

  // ── Pacing circle position (lazy-8) ─────────────────────────────────────────
  function getPacing(elapsed) {
    const geo = geoRef.current
    if (!geo) return null
    const cyc = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS
    let f, phase
    if (cyc < INHALE_MS) { f = (cyc / INHALE_MS) * 0.5; phase = 'in' }        // top lobe
    else                 { f = 0.5 + ((cyc - INHALE_MS) / EXHALE_MS) * 0.5; phase = 'out' } // bottom lobe
    const p = pointAtArcFrac(geo, f)
    return { x: p.x, y: p.y, fraction: f * geo.sides, phase }
  }

  // ── Pointer handlers ─────────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return
    fingerPosRef.current = { x: px, y: py }

    const proj = projectGlobal(geo, px, py)
    if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return  // off-track: ignore

    if (!startedRef.current) {
      startedRef.current   = true
      gameStartRef.current = performance.now()
      onGameStart?.()

      // Dismiss the fingerprint affordance on first valid touch.
      fingerprintActiveRef.current = false
      fpDismissingRef.current      = true
      fpDismissTRef.current        = 0
      cancelAnimationFrame(dismissRafRef.current)
      const dismissStart = performance.now()
      function dismissTick(ts) {
        const t = Math.min(1, (ts - dismissStart) / 400)
        fpDismissTRef.current = easeIn(t)
        if (t < 1) dismissRafRef.current = requestAnimationFrame(dismissTick)
        else { fpDismissingRef.current = false; fpDismissTRef.current = 1 }
      }
      dismissRafRef.current = requestAnimationFrame(dismissTick)
    }

    // Snap the bead to wherever on the path the finger landed (first touch OR
    // re-touch after a lift — both resume anywhere on the curve).
    beadIdxRef.current  = proj.idx
    const frac          = fractionAt(geo, proj.idx)
    prevFracRef.current = frac
    childPosRef.current = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: frac }
    touchRef.current    = true

    // Wake starts at the touch point (no splash — just the beginning of the trail).
    wakeTrailRef.current.push({ x: px, y: py, age: 0 })
    lastWakePtRef.current = { x: px, y: py }
  }

  function onPointerMove(px, py) {
    if (!touchRef.current) return
    fingerPosRef.current = { x: px, y: py }
  }

  function onPointerUp() {
    touchRef.current         = false
    tracingRef.current       = false
    childPathRateRef.current = 0
    // Stop laying trail points; the existing wake ages out on its own (heals).
    lastWakePtRef.current = null
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

    let lastW = 0, lastH = 0

    function resize() {
      dprRef.current = window.devicePixelRatio || 1
      const dpr  = dprRef.current
      const rect = { width: canvas.offsetWidth, height: canvas.offsetHeight }
      if (rect.width === 0 || rect.height === 0) return
      if (rect.width === lastW && rect.height === lastH) return
      lastW = rect.width
      lastH = rect.height

      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr

      const pacingCanvas = pacingCanvasRef?.current
      if (pacingCanvas) {
        pacingCanvas.width  = rect.width  * dpr
        pacingCanvas.height = rect.height * dpr
      }

      geoRef.current = buildGeo(rect)
      const geo = geoRef.current

      // Build the centerline Path2D once (CSS px; ctx is dpr-scaled each frame).
      const path = new Path2D()
      path.moveTo(geo.points[0].x, geo.points[0].y)
      for (let i = 1; i <= geo.points.length - 1; i++) path.lineTo(geo.points[i].x, geo.points[i].y)
      trackPathRef.current = path

      onResize?.({ labelMids: geo.labelMids, size: geo.sizeHandle })
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
      const { lw } = geo

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 1. Track — invisible by design (see SHOW_TRACK) ───────────────────
      // Geometry still guides the pacing circle + bead; the band is only drawn
      // when the dev toggle is on.
      const path = trackPathRef.current
      if (SHOW_TRACK && path) {
        ctx.lineJoin = 'round'
        ctx.lineCap  = 'round'
        ctx.strokeStyle = TRACK_SHADOW
        ctx.lineWidth   = lw + 6
        ctx.stroke(path)
        ctx.strokeStyle = TRACK_BODY
        ctx.lineWidth   = lw
        ctx.stroke(path)
      }

      // ── 1b. Wake — trail the fingertip with a soft ribbon that heals behind ──
      // Lay evenly-spaced trail points along the drag (interpolated so a fast
      // drag stays continuous). No splash, no rings — just the furrow.
      if (touchRef.current && fingerPosRef.current) {
        const fp   = fingerPosRef.current
        const last = lastWakePtRef.current
        const spacing = lw * WAKE_SPACING_LW
        if (!last) {
          wakeTrailRef.current.push({ x: fp.x, y: fp.y, age: 0 })
          lastWakePtRef.current = { x: fp.x, y: fp.y }
        } else {
          const dx = fp.x - last.x, dy = fp.y - last.y
          const moved = Math.hypot(dx, dy)
          if (moved >= spacing) {
            const steps = Math.min(WAKE_MAX, Math.floor(moved / spacing))
            for (let s = 1; s <= steps; s++) {
              const t = (s * spacing) / moved
              wakeTrailRef.current.push({ x: last.x + dx * t, y: last.y + dy * t, age: 0 })
            }
            lastWakePtRef.current = { x: fp.x, y: fp.y }
          }
        }
      }

      // Age + prune the trail (the water heals), then cap its length.
      const trail = wakeTrailRef.current
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age += dt
        if (trail[i].age >= WAKE_LIFE_MS) trail.splice(i, 1)
      }
      if (trail.length > WAKE_MAX) trail.splice(0, trail.length - WAKE_MAX)

      // Draw the wake as a single smooth ribbon (quadratic through the points, so
      // no beading), in a few overlapping head-biased passes: the whole trail gets
      // one faint wide pass, and progressively shorter head-portions add narrower,
      // slightly firmer passes on top. The overlap sums to a soft head→tail
      // gradient — brightest + tightest at the fingertip, spreading + dissolving
      // behind. A global fade keyed to the newest point lets the whole thing heal
      // after the finger lifts. Source-over, very low alpha.
      if (trail.length >= 2) {
        const n = trail.length
        const globalFade = Math.max(0, 1 - trail[n - 1].age / WAKE_LIFE_MS)
        if (globalFade > 0.01) {
          ctx.save()
          ctx.lineCap  = 'round'
          ctx.lineJoin = 'round'
          const a = WAKE_ALPHA * globalFade
          const strokeSmooth = (startIdx, width, alpha) => {
            if (alpha < 0.004 || startIdx >= n - 1) return
            ctx.strokeStyle = `rgba(${WAKE_COLOR},${alpha.toFixed(3)})`
            ctx.lineWidth   = width
            ctx.beginPath()
            ctx.moveTo(trail[startIdx].x, trail[startIdx].y)
            for (let i = startIdx + 1; i < n - 1; i++) {
              const mx = (trail[i].x + trail[i + 1].x) / 2
              const my = (trail[i].y + trail[i + 1].y) / 2
              ctx.quadraticCurveTo(trail[i].x, trail[i].y, mx, my)
            }
            ctx.lineTo(trail[n - 1].x, trail[n - 1].y)
            ctx.stroke()
          }
          const bw = lw * WAKE_WIDTH_LW
          strokeSmooth(0,                    bw * 1.7,  a * 0.30)  // full length — spreading tail
          strokeSmooth(Math.floor(n * 0.45), bw * 1.15, a * 0.45)  // recent — the body
          strokeSmooth(Math.floor(n * 0.75), bw * 0.75, a * 0.60)  // head — tightest at the finger
          ctx.restore()
        }
      }

      // ── Pacing position ───────────────────────────────────────────────────
      const pacingPos = getPacing(now - pacingStartRef.current)

      // ── Bead tracing core ─────────────────────────────────────────────────
      tracingRef.current = false
      if (startedRef.current && touchRef.current && fingerPosRef.current && beadIdxRef.current !== null) {
        const fp       = fingerPosRef.current
        const leashPx  = geo.lw * LEASH_TRACK_WIDTHS
        const acceptPx = geo.lw * ACCEPTANCE_TRACK_WIDTHS
        const proj     = projectLocal(geo, beadIdxRef.current, fp.x, fp.y, leashPx)

        if (proj && proj.perpDist <= acceptPx) {
          const prevIdx = beadIdxRef.current
          const newIdx  = proj.idx
          const newFrac = fractionAt(geo, newIdx)

          const gapFrac = (arcGapPx(geo, prevIdx, newIdx) / geo.totalPathLength) * geo.sides
          if (dt > 0) childPathRateRef.current = childPathRateRef.current * 0.5 + (Math.abs(gapFrac) / dt) * 0.5

          beadIdxRef.current  = newIdx
          childPosRef.current = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: newFrac }
          prevFracRef.current = newFrac
          tracingRef.current  = true
        }
      }
      if (!tracingRef.current) childPathRateRef.current = 0

      // ── Heat gauge ─────────────────────────────────────────────────────────
      // pacingRate = fraction-units per ms the pacing circle covers (sides per
      // CYCLE_MS with equal in/out durations).
      if (startedRef.current) {
        const pacingRate = geo.sides / CYCLE_MS
        const speedRatio = childPathRateRef.current / pacingRate
        const r = gaugeMachineRef.current.update(dt, { speedRatio, touching: tracingRef.current })
        gaugeActiveRef.current = r.gaugeActive
        gaugeEffectRef.current = r.gaugeEffect
        document.documentElement.style.setProperty('--game-saturation', (1 - r.gaugeEffect * 0.9).toFixed(3))
      }

      // ── Synergy ──────────────────────────────────────────────────────────
      {
        let close = false, inPace = false
        const canEvaluate = startedRef.current && pacingPos && childPosRef.current
        if (canEvaluate) {
          const child      = childPosRef.current
          const dist       = Math.hypot(child.clx - pacingPos.x, child.cly - pacingPos.y)
          const speedRatio = childPathRateRef.current / (geo.sides / CYCLE_MS)
          close  = dist <= lw * SYNERGY_DIST_THRESHOLD_LW
          inPace = speedRatio <= GAUGE_SPEED_THRESHOLD
        }
        synergyStageRef.current = synergyMachineRef.current.update(dt, {
          touching:    tracingRef.current,
          gaugeActive: gaugeActiveRef.current,
          canEvaluate,
          close,
          inPace,
        })
      }
      const synStage   = synergyStageRef.current
      const synStage12 = Math.max(0, Math.min(1, synStage - 1))   // pacing fill → amber
      const synStage23 = Math.max(0, Math.min(1, synStage - 2))   // circle grows 1→1.5×

      ctx.restore()

      // ── Pacing circle — separate canvas above the saturate wrapper ─────────
      {
        const target = gaugeActiveRef.current ? 1 : 0
        const k = 1 - Math.exp(-dt / 400)
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
          const r     = baseR * (1 + 0.2 * emph) * (1 + 0.5 * synStage23)

          if (emph > 0.01) {
            const glowR = r * 1.5
            const glow  = pacingCtx.createRadialGradient(pacingPos.x, pacingPos.y, r * 0.5, pacingPos.x, pacingPos.y, glowR)
            glow.addColorStop(0, `rgba(255,200,130,${(0.45 * emph).toFixed(3)})`)
            glow.addColorStop(1, 'rgba(255,200,130,0)')
            pacingCtx.beginPath()
            pacingCtx.arc(pacingPos.x, pacingPos.y, glowR, 0, Math.PI * 2)
            pacingCtx.fillStyle = glow
            pacingCtx.fill()
          }

          const fillAlpha = 0.55 + 0.30 * emph
          const fillR = Math.round(255 - 43 * synStage12)
          const fillG = Math.round(255 - 95 * synStage12)
          const fillB = Math.round(255 - 169 * synStage12)
          pacingCtx.beginPath()
          pacingCtx.arc(pacingPos.x, pacingPos.y, r, 0, Math.PI * 2)
          pacingCtx.fillStyle = `rgba(${fillR},${fillG},${fillB},${fillAlpha.toFixed(3)})`
          pacingCtx.fill()
        }
        pacingCtx.restore()
      }

      // ── Fingerprint affordance (on main ctx, above the track) ──────────────
      if (fpImgReadyRef.current && pacingPos && (fingerprintActiveRef.current || fpDismissingRef.current)) {
        ctx.save()
        ctx.scale(dpr, dpr)
        const { x, y } = pacingPos
        const baseR    = lw * 0.45
        const dismissT = fpDismissTRef.current
        const fpR      = baseR * (1 - dismissT)
        const pulse    = 0.85 + 0.15 * Math.sin((now / 1000) * Math.PI)
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
        ctx.restore()
      }

      // ── External state snapshot (sound director) ──────────────────────────
      if (onGameStateTick) {
        const pacingRate = geo.sides / CYCLE_MS
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
      ro.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

export default InfinityCanvas
