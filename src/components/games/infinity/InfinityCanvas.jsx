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
import { buildNightSkyBg, mulberry32 } from './nightSky'

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

// ── Water disturbance (finger through water) ──────────────────────────────────
// The finger disturbs a water surface stretched over the star field. Three cues,
// all drawn on the game canvas (above the invisible track, below the pacing
// circle), all bounded per-frame — no additive glow, no per-pixel work, no
// filters, just arc/gradient fills + drawImage blits of the already-baked sky:
//
//   1. LENS  — a refractive dimple at the fingertip: a displaced blit of the
//      baked sky (stars visibly magnify/shift) with a dark depression + bright
//      meniscus rim, so the surface reads as pressed and pulled.
//   2. RIDGES — lit ripple wavefronts (bright moonlit crest + dark trough) shed
//      along the drag; their overlapping fronts read as a wake, not sonar rings.
//   3. REACTIVE STARS — a dynamic sparkle layer that brightens + bobs as a ridge
//      front sweeps past, so the touch visibly travels through the world.
//
// Distances are in track-widths (lw) so everything scales with screen size.

// Lens / meniscus dimple (fingertip)
const LENS_R_LW      = 1.30   // lens radius, track-widths
const LENS_MAG       = 0.45   // peak magnification at centre (sky sampled from a smaller area)
const LENS_RIM_A     = 0.5    // meniscus rim (Fresnel) highlight alpha
const LENS_SHADE_A   = 0.12   // faint depression — a thin inner-rim trough, not a dark disc
const LENS_RINGS     = 8      // concentric magnify steps (bounded drawImage blits/frame)
const LENS_CREST     = '228,234,255'  // cool moonlight for the rim

// Ripple ridges (lit wavefronts)
const RIDGE_SPACING_LW = 0.45   // shed a ridge every this many track-widths of travel
const RIDGE_IDLE_MS    = 180    // …and at least this often while the finger rests
const RIDGE_LIFE_MS    = 1600   // ridge lifetime
const RIDGE_MAX        = 22     // pool cap
const RIDGE_R0_LW      = 0.22   // start radius
const RIDGE_R1_LW      = 2.70   // end radius
const RIDGE_PLOP_R1_LW = 3.20   // larger reach for the touch-down ring
const RIDGE_CREST      = '224,231,252'  // cool moonlit crest highlight
const RIDGE_TROUGH     = '6,9,30'       // dark trough shadow (below the bg)
const RIDGE_CREST_A    = 0.55
const RIDGE_TROUGH_A   = 0.40

// Reactive stars (surface reacts to the disturbance)
const RSTAR_AREA_DIV = 9000   // one reactive star per this many px² of viewport
const RSTAR_BAND_LW  = 0.55   // ridge-front thickness that excites a star
const RSTAR_DECAY_MS = 650    // excitation decay
const RSTAR_BOOST    = 0.95   // added brightness at full excitation
const RSTAR_BOB_LW   = 0.05   // positional bob at full excitation

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

  // Water disturbance — refraction source, ridge pool, reactive stars
  const skyBitmapRef     = useRef(null)  // offscreen copy of the baked sky, for the lens blit
  const ridgesRef        = useRef([])    // { x, y, life, maxLife, r0, r1 } — lit wavefronts
  const reactiveStarsRef = useRef([])    // { x, y, r, base, col, exc, phase } — surface reacts
  const lastFingerPosRef = useRef(null)  // finger pos last frame (travel accrual)
  const ridgeDistAccumRef = useRef(0)    // px of finger travel accrued toward the next ridge
  const lastRidgeTimeRef = useRef(0)     // ts of last ridge shed (idle gate)

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

      ridgesRef.current        = []
      lastFingerPosRef.current = null
      ridgeDistAccumRef.current = 0
      lastRidgeTimeRef.current = 0
      for (const s of reactiveStarsRef.current) s.exc = 0

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

    // Water: a larger ridge "plops" outward from the touch point; the drag-trail
    // accrual starts here.
    const now = performance.now()
    spawnRidge(px, py, geo.lw * RIDGE_R0_LW, geo.lw * RIDGE_PLOP_R1_LW, now)
    lastFingerPosRef.current  = { x: px, y: py }
    ridgeDistAccumRef.current = 0
  }

  function onPointerMove(px, py) {
    if (!touchRef.current) return
    fingerPosRef.current = { x: px, y: py }
  }

  function onPointerUp() {
    touchRef.current         = false
    tracingRef.current       = false
    childPathRateRef.current = 0
    // Stop emitting; existing ridges finish expanding + fading (the water settles).
    lastFingerPosRef.current  = null
    ridgeDistAccumRef.current = 0
  }

  // ── Ridge spawner (pooled, capped) ────────────────────────────────────────────
  function spawnRidge(x, y, r0, r1, now) {
    const arr = ridgesRef.current
    const ring = arr.length < RIDGE_MAX
      ? (arr.push({}), arr[arr.length - 1])
      : arr.reduce((a, b) => (b.life < a.life ? b : a))   // recycle the most-faded
    ring.x = x; ring.y = y; ring.r0 = r0; ring.r1 = r1
    ring.life = RIDGE_LIFE_MS; ring.maxLife = RIDGE_LIFE_MS
    lastRidgeTimeRef.current = now
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

      // Refraction source — an offscreen copy of the baked sky, pixel-identical to
      // the background canvas (same fn + fixed seed). The lens samples this.
      skyBitmapRef.current = buildNightSkyBg(rect.width, rect.height, dpr)

      // Reactive stars — a dynamic sparkle layer (CSS px) seeded for stability.
      const rand = mulberry32(0x9A73C)
      const count = Math.round((rect.width * rect.height) / RSTAR_AREA_DIV)
      const stars = []
      for (let i = 0; i < count; i++) {
        const pick = rand()
        const col = pick < 0.18 ? '255,238,205' : pick < 0.34 ? '205,220,255' : '255,255,255'
        stars.push({
          x: rand() * rect.width,
          y: rand() * rect.height,
          r: 0.5 + rand() * rand() * 1.3,
          base: 0.12 + rand() * 0.28,   // dim at rest; pops when a ridge passes
          col,
          exc: 0,
          phase: rand() * Math.PI * 2,
        })
      }
      reactiveStarsRef.current = stars

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

      // ── 1b. Water disturbance — ridges, reactive stars, and the fingertip lens
      // Emission: shed lit ridges along the drag path (distance-gated + a slow
      // idle ring). Dense emission along motion is what makes the overlapping
      // fronts read as a wake.
      if (touchRef.current && fingerPosRef.current) {
        const fp   = fingerPosRef.current
        const last = lastFingerPosRef.current
        if (last) {
          ridgeDistAccumRef.current += Math.hypot(fp.x - last.x, fp.y - last.y)
        }
        lastFingerPosRef.current = { x: fp.x, y: fp.y }
        const step = lw * RIDGE_SPACING_LW
        while (ridgeDistAccumRef.current >= step) {
          ridgeDistAccumRef.current -= step
          spawnRidge(fp.x, fp.y, lw * RIDGE_R0_LW, lw * RIDGE_R1_LW, now)
        }
        if (now - lastRidgeTimeRef.current >= RIDGE_IDLE_MS) {
          spawnRidge(fp.x, fp.y, lw * RIDGE_R0_LW, lw * RIDGE_R1_LW, now)
        }
      }

      // Pass 1 — age ridges, compute current radius/envelope, drop the dead.
      const ridges = ridgesRef.current
      for (let i = ridges.length - 1; i >= 0; i--) {
        const rg = ridges[i]
        rg.life -= dt
        if (rg.life <= 0) { ridges.splice(i, 1); continue }
        const t = rg.life / rg.maxLife                 // 1 → 0
        rg._t   = t
        rg._r   = rg.r0 + (rg.r1 - rg.r0) * easeOutSoft(1 - t)
        rg._env = smoothstep(Math.min(1, t * 2.2)) * t // fade in at birth, out with age
      }

      // Reactive stars — always updated/drawn (so they settle after a lift). A
      // ridge front sweeping past a star excites it; excitation decays.
      {
        const stars = reactiveStarsRef.current
        const band  = lw * RSTAR_BAND_LW
        const decay = Math.max(0, 1 - dt / RSTAR_DECAY_MS)
        for (const s of stars) {
          s.exc *= decay
          for (let j = 0; j < ridges.length; j++) {
            const rg = ridges[j]
            const df = Math.abs(Math.hypot(s.x - rg.x, s.y - rg.y) - rg._r)
            if (df < band) {
              const e = (1 - df / band) * rg._env
              if (e > s.exc) s.exc = e
            }
          }
          const bright = Math.min(1, s.base + s.exc * RSTAR_BOOST)
          if (bright < 0.02) continue
          const rr = s.r * (1 + s.exc * 0.6)
          const by = s.y - s.exc * lw * RSTAR_BOB_LW * (0.6 + 0.4 * Math.sin(now / 900 + s.phase))
          ctx.fillStyle = `rgba(${s.col},${bright.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(s.x, by, rr, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Pass 2 — draw ridges as lit wavefronts: a dark trough just inside a bright
      // moonlit crest, so each reads as a raised ridge catching light (not a glow).
      if (ridges.length) {
        ctx.save()
        for (const rg of ridges) {
          const env = rg._env
          if (env < 0.01) continue
          const wCrest = lw * 0.09 * (0.5 + rg._t * 0.6)
          // Trough sits just inside the crest — but only once the ring is big
          // enough that the inner stroke won't collapse into a filled dark disc.
          const troughR = rg._r - wCrest
          if (troughR > wCrest * 1.6) {
            ctx.strokeStyle = `rgba(${RIDGE_TROUGH},${(RIDGE_TROUGH_A * env).toFixed(3)})`
            ctx.lineWidth   = wCrest * 1.5
            ctx.beginPath()
            ctx.arc(rg.x, rg.y, troughR, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.strokeStyle = `rgba(${RIDGE_CREST},${(RIDGE_CREST_A * env).toFixed(3)})`
          ctx.lineWidth   = wCrest
          ctx.beginPath()
          ctx.arc(rg.x, rg.y, rg._r, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.restore()
      }

      // Fingertip LENS — a refractive dimple that magnifies the baked stars behind
      // the finger, with a soft depression and a bright meniscus rim. Concentric
      // magnify rings (bounded drawImage blits of the sky sub-rect), strongest at
      // the centre and easing to ~1× at the rim so it blends seamlessly.
      const sky = skyBitmapRef.current
      if (touchRef.current && fingerPosRef.current && sky) {
        const fp = fingerPosRef.current
        const R  = lw * LENS_R_LW
        for (let k = LENS_RINGS - 1; k >= 0; k--) {
          const r1  = (R * (k + 1)) / LENS_RINGS
          const r0  = (R * k) / LENS_RINGS
          const e   = 1 - (r0 + r1) / (2 * R)      // 1 at centre → 0 at rim
          const mag = 1 + LENS_MAG * e * e         // magnify, easing to 1× at the rim
          ctx.save()
          ctx.beginPath()
          ctx.arc(fp.x, fp.y, r1, 0, Math.PI * 2)
          ctx.arc(fp.x, fp.y, r0, 0, Math.PI * 2, true)
          ctx.clip('evenodd')
          ctx.translate(fp.x, fp.y); ctx.scale(mag, mag); ctx.translate(-fp.x, -fp.y)
          ctx.drawImage(
            sky,
            (fp.x - R) * dpr, (fp.y - R) * dpr, 2 * R * dpr, 2 * R * dpr,
            fp.x - R, fp.y - R, 2 * R, 2 * R,
          )
          ctx.restore()
        }
        // Depression trough — a soft dark ring hugging the inside of the rim (the
        // meniscus shadow), leaving the centre clear so the refracted stars show.
        const shade = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, R)
        shade.addColorStop(0,    'rgba(6,9,30,0)')
        shade.addColorStop(0.6,  'rgba(6,9,30,0)')
        shade.addColorStop(0.85, `rgba(6,9,30,${LENS_SHADE_A.toFixed(3)})`)
        shade.addColorStop(1,    'rgba(6,9,30,0)')
        ctx.fillStyle = shade
        ctx.beginPath()
        ctx.arc(fp.x, fp.y, R, 0, Math.PI * 2)
        ctx.fill()
        // Meniscus rim — bright Fresnel highlight at the lens edge.
        ctx.strokeStyle = `rgba(${LENS_CREST},${LENS_RIM_A})`
        ctx.lineWidth   = lw * 0.08
        ctx.beginPath()
        ctx.arc(fp.x, fp.y, R - lw * 0.04, 0, Math.PI * 2)
        ctx.stroke()
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
