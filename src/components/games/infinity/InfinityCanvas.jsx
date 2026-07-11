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
// The ONLY finger effect: a soft canoe WAKE, shed-and-LEFT-BEHIND like the photos.
// As the finger moves it EMITS wavelet pairs (a left + a right little crescent).
// Once born, each wavelet is anchored in the world (it does NOT follow the finger)
// and lives on its own: it slowly grows, drifts outward (the two arms spreading
// apart), and fades to nothing. The finger keeps shedding new small ones near it,
// so a diverging V of feathered wavelets is left behind in its path. Calm and
// low-contrast: no rings, no glow, very low alpha (base ribbon is
// source-over; the highlight/shadow bands below use screen/multiply).
// A wavelet is born small + more opaque + already out to the side/front, then
// grows, drifts outward, and fades to the SAME final state (offset/size/gone)
// as before. Thickness has its OWN gentle linear ramp (decoupled from the
// crescent half-length) so it never compounds down to a sub-pixel sliver at
// birth.
//
// Each wavelet is rendered as ONE filled tapered ribbon (ctx.fill over a
// hand-built outline), not stamped circular dabs — thickest at its middle
// sample, gently tapering (not to a sharp point) at both ends — so it reads
// as a whole little wave rather than a string of beads. Two fill passes
// (wide+faint, then narrow+firm) fake a soft edge cheaply, without shadowBlur.
const WAKELET_LIFE_MS     = 1600   // each wavelet: grow → spread → dissipate over this long
const SHED_SPACING_LW     = 0.4741 // shed a wavelet PAIR every this much finger travel (density) — 0.20/0.75^3, i.e. shed frequency -25% three times
const WAKELET_MAX         = 110    // particle-pool cap
// Arm spacing — INIT_OFF and SPREAD both halved (0.48→0.24, 0.76→0.38) from the
// prior tuning so the two arms are 50% closer together both at birth and at
// full spread: off(t) = INIT_OFF + SPREAD·t is linear, so scaling both terms
// by the same factor scales the whole birth→fade-out trajectory by that same
// factor at every t, not just the endpoints.
const WAKELET_INIT_OFF_LW = 0.24   // starting side offset
const WAKELET_SPREAD_LW   = 0.38   // extra outward drift over life  → final offset = INIT_OFF + SPREAD (0.62)
const WAKELET_FRONT_OFF_LW= 0.18   // born this far ahead of the shed point (toward the front of the touch)
// Birth size — INIT_LEN and THICK_INIT each dropped 25% from the prior tuning
// (a wavelet is born smaller), while GROW/THICK_GROW increased by the same
// absolute amount so the FINAL size (INIT + GROW) is unchanged — the wavelet
// still grows to the exact same peak length/thickness it always did, just
// from a smaller starting point.
const WAKELET_INIT_LEN_LW = 0.15   // starting crescent half-length (was 0.20 — 25% smaller)
const WAKELET_GROW_LW     = 1.21   // growth over life             → final half-length = INIT_LEN + GROW (1.36, unchanged)
const WAKELET_THICK_INIT_LW = 0.028125 // starting peak (middle) half-thickness (was 0.0375 — 25% smaller)
const WAKELET_THICK_GROW_LW = 0.046875 // peak-thickness growth over life → final = INIT + GROW (0.075, unchanged)
const WAKELET_SAMPLES     = 9      // ribbon cross-section samples (more = smoother taper curve)
const WAKELET_BOW         = 0.55   // crescent bow toward the direction of travel (× half-length)
// The tip axis was pure "outward, perpendicular to travel" (0°/180°). Tilt it
// 45° so the tip nearer the path swings toward the FORWARD direction (pulled
// "higher", closer to the finger) and the tip farther from the path swings
// BACKWARD (trailing, "lower") — like the diagonal wavelets in the reference
// photos, not a perpendicular crescent. Baked once (module load), reused as a
// rotation of each wavelet's own outward axis (side-corrected, so it mirrors
// correctly for the left and right arms).
const WAKELET_TILT_DEG = 45
const WAKELET_TILT_COS = Math.cos(WAKELET_TILT_DEG * Math.PI / 180)
const WAKELET_TILT_SIN = Math.sin(WAKELET_TILT_DEG * Math.PI / 180)
const WAKE_ALPHA          = 0.12   // peak fill alpha — intentionally faint (unchanged final)
const WAKE_COLOR          = '205,210,236'  // soft cool moonlight-lavender
// Two fill passes per wavelet — wide+faint outer, narrow+firm inner — fake a
// soft feathered edge without shadowBlur (expensive to animate on iOS Safari).
const WAKELET_RIBBON_PASSES = [
  { thick: 1.8, alpha: 0.35 },
  { thick: 1,   alpha: 1    },
]

// Highlight/shadow — fakes light on water using the wavelet's OWN outward
// curvature as the "light source": the outward-facing edge (the crest,
// catching open sky) gets a highlight band, the inward-facing edge (the
// trough, toward the path) gets a shadow band. No fixed world light
// direction needed, so it stays consistent regardless of which way the
// finger moves. Colors pulled from the actual baked night sky (nightSky.js)
// rather than invented: highlight leans toward the pale-blue star tint
// (205,220,255), shadow leans toward the deep navy base wash (#0E1235 /
// #181A47) lightened just enough to still read against a dark background.
// Composited with 'screen' (brightens what's beneath) / 'multiply' (darkens
// it) instead of flat source-over, so the light actually interacts with the
// scene rather than looking painted on top of it.
const WAKE_HIGHLIGHT_COLOR = '220,230,255'
const WAKE_SHADOW_COLOR    = '48,52,98'
const WAKELET_EDGE_THICK_MUL = 0.55  // highlight/shadow band width, × the base ribbon's half-thickness
const WAKELET_EDGE_SHIFT_MUL = 0.42  // how far the band rides toward its edge, × peak half-thickness
const WAKELET_EDGE_PASSES = [
  { color: WAKE_HIGHLIGHT_COLOR, alphaMul: 0.65, shiftSign: 1,  blend: 'screen'   },
  { color: WAKE_SHADOW_COLOR,    alphaMul: 0.55, shiftSign: -1, blend: 'multiply' },
]
// Tip fade — the ribbon still reads as a "drawn stroke" because it has a
// crisp, uniform-opacity edge even after v20's width taper; real water
// disturbance loses visibility toward the edges of the disturbed patch, not
// just width. Fade each wavelet's OPACITY toward both tips (independent of,
// and on top of, the width taper) via a linear gradient along its own
// length instead of a flat fillStyle — one gradient per wavelet per color
// (reused across every pass painted in that color), so this adds no extra
// draw calls, just per-pixel color interpolation on the same tiny fills.
const WAKELET_TIP_FADE = 0.3   // fraction of the ribbon's length, from each tip, that fades toward transparent

// Per-wavelet randomness — seeded once at spawn (not per-frame), so it costs a
// handful of Math.random() calls only when a wavelet is born, never in the
// draw loop. This is what keeps the wake from reading as a stamped, metronomic
// pattern: no two wavelets (not even a spawned L/R pair) grow, fade, or curve
// identically, so the family resemblance stays but the rhythm feels organic.
const WAKELET_JITTER_SIZE     = 0.14   // ± size variance (offset/length/thickness together)
const WAKELET_JITTER_LIFE     = 0.18   // ± lifetime variance — desyncs the grow/fade rhythm
const WAKELET_JITTER_FADE     = 0.35   // ± fade-in-speed variance — desyncs the birth pop
const WAKELET_FADE_IN_FRAC    = 0.22   // fraction of life spent fading IN — a gentle build, still much quicker than the ~100%-of-life fade-out
const WAKELET_JITTER_BOW      = 0.25   // ± crescent-curvature variance
const WAKELET_JITTER_POS_LW   = 0.06   // birth-position jitter along the direction of travel, × lw
const WAKELET_WOBBLE_AMT      = 0.10   // contour wobble amplitude (fraction of half-length) — breaks the perfect parabola
// Wobble is a smooth sine wave (own random frequency + phase per wavelet, set
// once at spawn), NOT independent per-sample noise — independent noise made
// neighboring centerline samples uncorrelated, and differentiating that for
// the ribbon's edge normals amplified it into sharp kinks. A sine is
// continuous, so consecutive samples stay correlated and the outline stays
// smooth while each wavelet still gets its own unique gentle undulation.
const WAKELET_WOBBLE_FREQ_MIN = 0.5   // fewest wave-cycles across the crescent's length
const WAKELET_WOBBLE_FREQ_MAX = 1.5   // most wave-cycles across the crescent's length
// Sample positions across the ribbon (u ∈ [-1,1]) and their taper profile —
// both fixed by WAKELET_SAMPLES, so bake them once instead of recomputing per
// particle per frame. Raised to a power > 1 (sharper than a plain parabola) so
// it stays slender along most of its length and only pinches wide right at
// the center — reads as a curved ARC, not a rounded half-circle blob. Rescaled
// into [TAPER_FLOOR, 1] (not [0, 1]) so the tips keep real width instead of
// coming to a sharp point — still 1 (full peak thickness) at the middle, but a
// subtle taper down to TAPER_FLOOR at the ends rather than all the way to 0.
const WAKELET_TAPER_POWER = 1.8
const WAKELET_TAPER_FLOOR = 0.6
const WAKELET_U = Array.from({ length: WAKELET_SAMPLES }, (_, k) => (k / (WAKELET_SAMPLES - 1)) * 2 - 1)
const WAKELET_TAPER = WAKELET_U.map(u => {
  const raw = Math.pow(Math.max(0, 1 - u * u), WAKELET_TAPER_POWER)
  return WAKELET_TAPER_FLOOR + (1 - WAKELET_TAPER_FLOOR) * raw
})

const smoothstep  = t => t * t * (3 - 2 * t)
const easeIn      = t => t * t * t
const easeOutSoft = t => 1 - Math.pow(1 - t, 2)

// A linear gradient along (x0,y0)->(x1,y1), opaque `colorRGB` in the middle,
// fading to fully transparent over WAKELET_TIP_FADE at each end. Used as the
// wavelet ribbon's fillStyle so opacity fades toward the tips — perpendicular
// position doesn't matter for a linear gradient, so the SAME gradient (built
// from the wavelet's centerline) is reused for its laterally-offset
// highlight/shadow bands too.
function buildTipFadeGradient(ctx, x0, y0, x1, y1, colorRGB) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, `rgba(${colorRGB},0)`)
  g.addColorStop(WAKELET_TIP_FADE, `rgba(${colorRGB},1)`)
  g.addColorStop(1 - WAKELET_TIP_FADE, `rgba(${colorRGB},1)`)
  g.addColorStop(1, `rgba(${colorRGB},0)`)
  return g
}

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

  // Wake — a pool of shed-and-left-behind wavelet particles
  const wakeletsRef    = useRef([])    // [{ x, y, nx, ny, fx, fy, side, age, maxLife }]
  const lastShedPosRef = useRef(null)  // last finger pos a wavelet pair was shed at
  // Reusable scratch buffers for the ribbon build (centerline + normals) — sized
  // once to WAKELET_SAMPLES and overwritten per wavelet per frame, so drawing
  // the wake never allocates.
  const wakeScratchXRef  = useRef(new Float32Array(WAKELET_SAMPLES))
  const wakeScratchYRef  = useRef(new Float32Array(WAKELET_SAMPLES))
  const wakeScratchNXRef = useRef(new Float32Array(WAKELET_SAMPLES))
  const wakeScratchNYRef = useRef(new Float32Array(WAKELET_SAMPLES))

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

      wakeletsRef.current      = []
      lastShedPosRef.current   = null

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

    // Wake: mark the shed origin (no splash). Wavelets are shed as the finger moves.
    lastShedPosRef.current = { x: px, y: py }
  }

  function onPointerMove(px, py) {
    if (!touchRef.current) return
    fingerPosRef.current = { x: px, y: py }
  }

  function onPointerUp() {
    touchRef.current         = false
    tracingRef.current       = false
    childPathRateRef.current = 0
    // Stop shedding; the wavelets already in the water grow, spread, and fade out.
    lastShedPosRef.current = null
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

      // ── 1b. Wake — shed wavelet pairs, then let them live in the water ───────
      // While the finger moves, emit a left + right wavelet every SHED_SPACING of
      // travel, born at the finger with its current heading. Each is world-anchored
      // (does NOT follow the finger) — below it grows, drifts outward, and fades.
      if (touchRef.current && fingerPosRef.current) {
        const fp = fingerPosRef.current
        if (!lastShedPosRef.current) lastShedPosRef.current = { x: fp.x, y: fp.y }
        const last = lastShedPosRef.current
        const dx = fp.x - last.x, dy = fp.y - last.y
        const moved = Math.hypot(dx, dy)
        const shedStep = lw * SHED_SPACING_LW
        if (moved >= shedStep) {
          const ux = dx / moved, uy = dy / moved   // direction of travel
          const nx = -uy, ny = ux                  // perpendicular
          const front = lw * WAKELET_FRONT_OFF_LW  // born ahead of the shed point (toward the front)
          const num = Math.min(8, Math.floor(moved / shedStep))
          const pool = wakeletsRef.current
          for (let s = 1; s <= num; s++) {
            const bx = last.x + dx * ((s * shedStep) / moved) + ux * front
            const by = last.y + dy * ((s * shedStep) / moved) + uy * front
            for (const side of [1, -1]) {
              const w = pool.length < WAKELET_MAX
                ? (pool.push({}), pool[pool.length - 1])
                : pool.reduce((a, b) => (b.age > a.age ? b : a))   // recycle the oldest
              // Each side gets its own position jitter — an L/R pair spawned
              // "together" no longer lands as an exact mirror image.
              const posJ = (Math.random() * 2 - 1) * lw * WAKELET_JITTER_POS_LW
              w.x = bx + ux * posJ; w.y = by + uy * posJ
              w.nx = nx; w.ny = ny; w.fx = ux; w.fy = uy
              w.side = side; w.age = 0
              w.maxLife = WAKELET_LIFE_MS * (1 + (Math.random() * 2 - 1) * WAKELET_JITTER_LIFE)
              w.sizeMul = 1 + (Math.random() * 2 - 1) * WAKELET_JITTER_SIZE
              w.fadeMul = 1 + (Math.random() * 2 - 1) * WAKELET_JITTER_FADE
              w.bowMul  = 1 + (Math.random() * 2 - 1) * WAKELET_JITTER_BOW
              w.wobFreq  = WAKELET_WOBBLE_FREQ_MIN + Math.random() * (WAKELET_WOBBLE_FREQ_MAX - WAKELET_WOBBLE_FREQ_MIN)
              w.wobPhase = Math.random() * Math.PI * 2
            }
          }
          lastShedPosRef.current = { x: fp.x, y: fp.y }
        }
      }

      // Age + draw the wavelets. Each grows, drifts outward (arms spreading), and
      // fades over its life, anchored where it was born (left behind in the water).
      // Rendered as a filled tapered ribbon (see wakeScratch* below), not stamped
      // dabs, so each wavelet reads as one whole little wave.
      const pool = wakeletsRef.current
      if (pool.length) {
        const S  = WAKELET_SAMPLES
        const sx = wakeScratchXRef.current, sy = wakeScratchYRef.current
        const nx = wakeScratchNXRef.current, ny = wakeScratchNYRef.current
        ctx.save()
        for (let i = pool.length - 1; i >= 0; i--) {
          const w = pool[i]
          w.age += dt
          if (w.age >= w.maxLife) { pool.splice(i, 1); continue }
          const t   = w.age / w.maxLife
          // Gentle eased build-in (smoothstep, not linear, so it starts very
          // faint and gradually accelerates — reads as the finger's motion
          // "building" the wave rather than popping it in), then a much
          // slower fade to nothing over the rest of its life. fadeMul
          // desyncs how quickly each individual wavelet builds in.
          const env = smoothstep(Math.min(1, t / (WAKELET_FADE_IN_FRAC * w.fadeMul))) * (1 - t)
          const a   = WAKE_ALPHA * env
          if (a < 0.004) continue
          // sizeMul makes each wavelet's whole family of dimensions slightly
          // bigger or smaller than its neighbors (still shares the same curve).
          const off      = lw * (WAKELET_INIT_OFF_LW + WAKELET_SPREAD_LW * t) * w.sizeMul  // drifts outward
          const half     = lw * (WAKELET_INIT_LEN_LW + WAKELET_GROW_LW * t) * w.sizeMul     // grows
          const peakThick = lw * (WAKELET_THICK_INIT_LW + WAKELET_THICK_GROW_LW * t) * w.sizeMul  // own gentle ramp — never sub-pixel
          const bow      = WAKELET_BOW * half * w.bowMul
          const cxp      = w.x + w.nx * w.side * off
          const cyp      = w.y + w.ny * w.side * off
          // True outward axis for THIS arm (flips correctly with side, so
          // "inward" always means "toward the path" for both L and R), rotated
          // 45° toward -forward — this is what tilts u=-1 (inward tip) toward
          // +forward and u=+1 (outward tip) toward -forward (backward).
          const ioX  = w.nx * w.side, ioY = w.ny * w.side
          const tiltX = ioX * WAKELET_TILT_COS - w.fx * WAKELET_TILT_SIN
          const tiltY = ioY * WAKELET_TILT_COS - w.fy * WAKELET_TILT_SIN

          // Centerline samples — same curve + wobble as before, along the
          // tilted axis instead of the raw perpendicular.
          for (let k = 0; k < S; k++) {
            const u   = WAKELET_U[k]
            const b   = bow * (1 - u * u)               // parabolic bow toward travel
            // Smooth per-wavelet wobble (own frequency + phase, set at spawn)
            // — a sine, not independent per-sample noise, so the contour
            // stays smooth instead of zigzagging between samples.
            const wob = Math.sin(u * Math.PI * w.wobFreq + w.wobPhase) * half * WAKELET_WOBBLE_AMT
            sx[k] = cxp + tiltX * (half * u + wob) + w.fx * b
            sy[k] = cyp + tiltY * (half * u + wob) + w.fy * b
          }
          // Per-sample unit normal (finite difference of the centerline) —
          // shared by both fill passes below, so it's computed only once.
          for (let k = 0; k < S; k++) {
            const k0 = k === 0 ? 0 : k - 1
            const k1 = k === S - 1 ? S - 1 : k + 1
            const tx = sx[k1] - sx[k0], ty = sy[k1] - sy[k0]
            const tl = Math.hypot(tx, ty) || 1
            nx[k] = -ty / tl; ny[k] = tx / tl
          }
          // Which fill direction (+normal or -normal) is actually "outward"
          // (away from the path) for THIS wavelet — decides which edge gets
          // the highlight vs the shadow below. One check (middle sample) is
          // enough; the ribbon doesn't curve enough to flip along its length.
          const midK = S >> 1
          const outwardSign = (nx[midK] * ioX + ny[midK] * ioY) >= 0 ? 1 : -1

          // Opacity fade toward both tips (perpendicular offset doesn't
          // matter for a linear gradient, so the same base/highlight/shadow
          // gradients — built once here from the centerline — are valid for
          // the laterally-shifted highlight/shadow bands below too).
          const gBase = buildTipFadeGradient(ctx, sx[0], sy[0], sx[S - 1], sy[S - 1], WAKE_COLOR)

          // Fill the tapered ribbon outline — thickest at the middle sample,
          // tapering to (not all the way to a point at) both ends. Two passes
          // (wide+faint, then narrow+firm) fake a soft edge without shadowBlur.
          ctx.fillStyle = gBase
          for (const pass of WAKELET_RIBBON_PASSES) {
            ctx.beginPath()
            for (let k = 0; k < S; k++) {
              const hw = peakThick * WAKELET_TAPER[k] * pass.thick
              const px = sx[k] + nx[k] * hw, py = sy[k] + ny[k] * hw
              if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
            }
            for (let k = S - 1; k >= 0; k--) {
              const hw = peakThick * WAKELET_TAPER[k] * pass.thick
              ctx.lineTo(sx[k] - nx[k] * hw, sy[k] - ny[k] * hw)
            }
            ctx.closePath()
            ctx.globalAlpha = a * pass.alpha
            ctx.fill()
          }

          // Highlight (outward edge, 'screen') + shadow (inward edge,
          // 'multiply') bands — narrower than the base ribbon and shifted
          // toward their respective edge, so light and shadow read as part
          // of the wave's own curvature rather than a flat painted stroke.
          // Same tip-fade treatment as the base ribbon, in each band's color.
          for (const edge of WAKELET_EDGE_PASSES) {
            const sign = outwardSign * edge.shiftSign
            ctx.beginPath()
            for (let k = 0; k < S; k++) {
              const hw    = peakThick * WAKELET_TAPER[k] * WAKELET_EDGE_THICK_MUL
              const shift = peakThick * WAKELET_EDGE_SHIFT_MUL * sign
              const px = sx[k] + nx[k] * (shift + hw), py = sy[k] + ny[k] * (shift + hw)
              if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
            }
            for (let k = S - 1; k >= 0; k--) {
              const hw    = peakThick * WAKELET_TAPER[k] * WAKELET_EDGE_THICK_MUL
              const shift = peakThick * WAKELET_EDGE_SHIFT_MUL * sign
              ctx.lineTo(sx[k] + nx[k] * (shift - hw), sy[k] + ny[k] * (shift - hw))
            }
            ctx.closePath()
            ctx.fillStyle = buildTipFadeGradient(ctx, sx[0], sy[0], sx[S - 1], sy[S - 1], edge.color)
            ctx.globalCompositeOperation = edge.blend
            ctx.globalAlpha = a * edge.alphaMul
            ctx.fill()
          }
          ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
        ctx.restore()
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
