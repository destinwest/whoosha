// ── HexagonCanvas.jsx ─────────────────────────────────────────────────────────
// Hexagon Breathing canvas — mirrors SquareCanvas in mechanics but draws a
// rounded flat-top hexagon track, traverses it clockwise from the lower-left
// vertex, and uses non-uniform side timings (4s breathe-in / 4s breathe-out /
// 2s hold, repeated twice per lap → 20s cycle).
//
// Most of this file is byte-identical to SquareCanvas (heat gauge, synergy,
// embers, paint composite, touch bloom, fingerprint, pointer handling, etc.).
// Shape-specific divergences are flagged with "── HEXAGON-SPECIFIC ──" headers.
//
// Props:
//   strokeModeRef  — { current: 'classic' | 'watercolor' }
//   pacingCanvasRef — ref to the overlay canvas above the saturate wrapper
//   onTick(now)    — called each rAF frame; HexagonGame drives intro from here
//   onGameStart()  — called once when the child first drags from the start point
//   interactive    — boolean; controls pointer events on the canvas element
//
// Imperative API (via ref):
//   reset()        — clears all canvas state and resets all game-state refs
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import * as stampStroke   from '../square/strokes/stampStroke'
import * as layeredWash   from '../square/strokes/layeredWash'
import { roundedNgonPath } from '../_shared/roundedNgonPath'

// ── HEXAGON-SPECIFIC: shape + timing ─────────────────────────────────────────
const SIDES                 = 6
const HEX_START_ANGLE       = (2 * Math.PI) / 3            // V[0] = lower-left vertex
const HEX_INSCRIBED_FACTOR  = Math.cos(Math.PI / 6)        // apothem / circumradius for regular hexagon
const SIDE_DURATIONS_MS     = [4000, 4000, 2000, 4000, 4000, 2000]  // breathe-in / out / hold x 2
const CYCLE_MS              = SIDE_DURATIONS_MS.reduce((a, b) => a + b, 0)  // 20_000

// Cumulative start time for each side — used by getPacing for non-uniform mapping
const SIDE_START_MS = SIDE_DURATIONS_MS.reduce((acc, dur, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + SIDE_DURATIONS_MS[i - 1])
  return acc
}, [])

// ── Constants ─────────────────────────────────────────────────────────────────
// Southern-Utah desert lap palette — warm terracotta/orange/dusty-rose with a
// sage-green accent, the warm counterpart to Square's cool forest sage/lavender.
const LAP_COLORS = ['#BC5E36', '#D08A4A', '#C58A8A', '#9BA67C']

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
const GAUGE_CHARGE_DELAY      = 1000  // ms of sustained too-fast before the gauge starts ramping
const GAUGE_DRAIN_DELAY       = 500   // ms of sustained recoverable-pace before recovery begins
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
// ── HEXAGON-SPECIFIC: geometry ───────────────────────────────────────────────
// Builds the centerline geometry for a rounded flat-top hexagon traversed
// clockwise from the lower-left vertex. The structure mirrors SquareCanvas's
// buildGeo: vertex/arc centers, straight-segment endpoints, sampled points
// along the centerline, and label midpoints — just with 6 sides instead of 4
// and computed from a circumradius R rather than a bounding-box side length.
function buildGeo(rect) {
  const w  = rect.width
  const h  = rect.height
  const cx = w / 2
  const cy = h / 2

  // Pick circumradius so the hexagon's bounding box fits within 78% of the
  // smaller screen dim, accounting for the flat-top aspect ratio (height =
  // 2R·cos(π/6) ≈ 1.732R; width = 2R). Width is usually the constraint on
  // portrait screens.
  const R       = Math.min(w * 0.39, h * 0.45)
  const r       = R * 0.18   // corner radius — slightly less than Square's 0.22 (120° interior angle)
  const circleR = R * 0.0728
  const lw      = circleR * 2 + 8

  // Vertex angles (canvas coords, +y down). Starting at lower-left (2π/3) and
  // incrementing CW (each next vertex at +π/3). Order:
  //   V0 lower-left, V1 left, V2 upper-left, V3 upper-right, V4 right, V5 lower-right
  const verts = []
  for (let i = 0; i < SIDES; i++) {
    const a = HEX_START_ANGLE + i * (Math.PI * 2 / SIDES)
    verts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  }

  // Corner-arc geometry. For an inscribed arc of radius r tangent to both edges
  // of a corner with interior angle θ, the tangent points sit at distance
  // r/tan(θ/2) from the vertex along each edge (NOT distance r — that's only
  // correct for a 90° square corner, where tan(45°)=1). Using the full r here
  // was the bug that made the traceable centerline diverge from the visible
  // track — which is drawn correctly by roundedNgonPath/arcTo — at every
  // hexagon corner, so the path couldn't be traced through the corners.
  const interiorAngle = (SIDES - 2) * Math.PI / SIDES   // 120° for a hexagon
  const exteriorAngle = Math.PI - interiorAngle          // 60° — the corner-arc sweep
  const cornerTangent = r / Math.tan(interiorAngle / 2)  // vertex→tangent-point distance

  // Side length = circumradius R for a regular hexagon. The straight portion of
  // each side is shorter by 2·cornerTangent (one tangent inset at each end); the
  // corner arc (length r·exterior) replaces the sharp vertex.
  const sideLen = R
  const LS      = sideLen - 2 * cornerTangent  // straight-segment length per side
  const LA      = r * exteriorAngle            // corner arc length
  const sf      = LS / (LS + LA)               // straight-fraction within each side

  // Per-side: straightFrom[i] is the start of the straight segment of side i;
  // straightTo[i] is the end. Both lie on the line between vertex i and i+1,
  // offset inward from each end by cornerTangent along the edge direction.
  const straightFrom = []
  const straightTo   = []
  for (let i = 0; i < SIDES; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % SIDES]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    straightFrom.push({ x: a.x + ux * cornerTangent, y: a.y + uy * cornerTangent })
    straightTo.push  ({ x: b.x - ux * cornerTangent, y: b.y - uy * cornerTangent })
  }

  // arcCenters[i] is the center of the corner-rounding arc at vertex i+1
  // (the vertex AFTER side i). It sits along the angle bisector of the two
  // edges meeting at that vertex, at distance d = r / sin(interior/2) from
  // the vertex. For a regular hex interior = 2π/3, so sin(60°) = √3/2 and
  // d = r / (√3/2) = 2r/√3 ≈ 1.1547·r. The center is INWARD from the vertex.
  //
  // We also store the start angle of each arc (the angle from the arc center
  // to the corresponding straightTo[i] point), and the arc spans CW by π/3.
  const arcCenters     = []
  const arcStartAngles = []
  for (let i = 0; i < SIDES; i++) {
    const v   = verts[(i + 1) % SIDES]
    const to  = straightTo[i]              // tangent point on the incoming edge
    const from = straightFrom[(i + 1) % SIDES]  // tangent point on the outgoing edge

    // Center is along the bisector from v toward the polygon interior.
    // Equivalent to (midpoint of `to` and `from`) projected away from v by the
    // right distance — but easier to compute as (to + from)/2 offset such that
    // |center - to| = r perpendicular to the incoming edge direction.
    // Use the perpendicular to edge direction: rotate edge tangent 90° CCW
    // (which points into the interior for a CW traversal).
    const edgeToV = { x: v.x - to.x, y: v.y - to.y }
    const edgeLen = Math.hypot(edgeToV.x, edgeToV.y)
    const tEdgeX = edgeToV.x / edgeLen
    const tEdgeY = edgeToV.y / edgeLen
    // Perpendicular pointing toward interior (left of the CW direction)
    const perpX = -tEdgeY
    const perpY =  tEdgeX
    const center = { x: to.x + perpX * r, y: to.y + perpY * r }
    arcCenters.push(center)

    // Start angle of arc = direction from center to `to` (the tangent point
    // where the incoming edge meets the arc).
    arcStartAngles.push(Math.atan2(to.y - center.y, to.x - center.x))
  }

  // Sample N points along the path, indexed by fraction (0 → SIDES per lap).
  // Within each side: 0..sf is the straight segment, sf..1 is the corner arc.
  const N      = SIDES * 100
  const points = []
  for (let i = 0; i <= N; i++) {
    const frac = (i / N) * SIDES
    const si   = Math.min(Math.floor(frac), SIDES - 1)
    const s    = frac - si
    if (s < sf) {
      const lt = s / sf
      const a  = straightFrom[si]
      const b  = straightTo[si]
      points.push({ x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt })
    } else {
      const arcT  = (s - sf) / (1 - sf)                     // 0 → 1 across the arc
      const ac    = arcCenters[si]
      // Arc sweeps by the exterior angle (π/3 for a hexagon). In canvas coords
      // (y down), "CW visually" = increasing angle.
      const angle = arcStartAngles[si] + arcT * exteriorAngle
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

  // Track "size" handle returned for downstream callers that previously used
  // `sq` (Square's bounding-box side). For hex, use 2R as the analogous "size".
  const sq = 2 * R

  return {
    cx, cy, sq, R, r, lw, sf,
    arcCenters, arcStartAngles,
    straightFrom, straightTo, verts,
    points, labelMids,
    totalPathLength,
    w, h,
  }
}


// ── Racetrack draw passes (hexagon) ──────────────────────────────────────────
// trackGeo: { cx, cy, R, cornerR, lw, startAngle } — all in CSS px.
// Each pass uses the same path geometry, stroking the rounded N-gon path with
// different widths/styles to build the layered "raised channel" effect.
//
// Inner-wall offset math: to inset the path so its stroke aligns with the
// inner edge of the track, the circumradius must shrink by lw/2 / cos(π/6)
// (because reducing R by Δ reduces the apothem by Δ·cos(30°) = Δ·0.866;
// we want the apothem to shrink by lw/2). The corner-radius reduction is
// the simple lw/2 because corner radius scales linearly with the path.
const HEX_INSET_FACTOR = 1 / Math.cos(Math.PI / 6)  // ≈ 1.1547 — multiply lw by this to get R-inset

// Called once per resize — returns a radial gradient for Pass B.
function buildTrackGradient(ctx, { cx, cy, R, lw }) {
  // innerR = inner edge of straight (apothem - lw/2)
  // outerR = beyond corners (~R + lw/2) so corners fall within the gradient
  const innerR = R * HEX_INSCRIBED_FACTOR - lw / 2
  const outerR = R + lw / 2
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
  grad.addColorStop(0,   '#FAF2E0')   // inner edge — lightest honey-cream
  grad.addColorStop(0.4, '#F2EAD0')   // base warm cream
  grad.addColorStop(1,   '#E6DBBF')   // outer edge — darkest sand-cream
  return grad
}

// Pass A — outer shadow: bleeds outside track footprint, soft drop shadow.
function drawTrackShadow(ctx, { cx, cy, R, cornerR, lw, startAngle }) {
  ctx.save()
  ctx.beginPath()
  roundedNgonPath(ctx, cx, cy, R, SIDES, cornerR, startAngle)
  ctx.lineWidth   = lw + 7
  ctx.strokeStyle = 'rgba(78,68,40,0.22)'
  ctx.stroke()
  ctx.restore()
}

// Pass B — gradient body: main cream surface.
function drawTrackBody(ctx, { cx, cy, R, cornerR, lw, startAngle }, trackGradient) {
  ctx.save()
  ctx.beginPath()
  roundedNgonPath(ctx, cx, cy, R, SIDES, cornerR, startAngle)
  ctx.lineWidth   = lw
  ctx.strokeStyle = trackGradient ?? '#F2EAD0'
  ctx.stroke()
  ctx.restore()
}

// Pass C — highlight rim: thin bright sheen on the inner lip (unused/inset).
function drawTrackHighlight(ctx, { cx, cy, R, cornerR, lw, startAngle }) {
  const innerR = R - (lw * 0.5) * HEX_INSET_FACTOR
  const innerCR = Math.max(0, cornerR - lw * 0.5)
  ctx.save()
  ctx.beginPath()
  roundedNgonPath(ctx, cx, cy, innerR, SIDES, innerCR, startAngle)
  ctx.lineWidth   = lw * 0.15
  ctx.strokeStyle = 'rgba(255,252,245,0.55)'
  ctx.stroke()
  ctx.restore()
}

// Pass D — inner wall shadow: faint dark stroke at the inner edge of track.
function drawTrackInnerWall(ctx, { cx, cy, R, cornerR, lw, startAngle }) {
  const innerR = R - (lw * 0.5) * HEX_INSET_FACTOR
  const innerCR = Math.max(0, cornerR - lw * 0.5)
  ctx.save()
  ctx.beginPath()
  roundedNgonPath(ctx, cx, cy, innerR, SIDES, innerCR, startAngle)
  ctx.lineWidth   = lw * 0.18
  ctx.strokeStyle = 'rgba(78,68,40,0.14)'
  ctx.stroke()
  ctx.restore()
}

// ── applyPaintClip ────────────────────────────────────────────────────────────
// Applies a permanent annular clip — outer hexagon minus inner hexagon — so
// painted strokes can never bleed outside the track channel.
// save() is intentionally never restored — the clip must persist.
function applyPaintClip(ctx, { cx, cy, R, cornerR, lw, startAngle }) {
  const outerR    = R + lw / 2 + 0.5
  const outerCR   = cornerR + lw / 2 + 0.5
  const innerR    = R - lw * HEX_INSET_FACTOR - 0.5
  const innerCR   = Math.max(0, cornerR - lw - 0.5)
  ctx.save()
  ctx.beginPath()
  roundedNgonPath(ctx, cx, cy, outerR, SIDES, outerCR, startAngle)
  roundedNgonPath(ctx, cx, cy, innerR, SIDES, innerCR, startAngle)
  ctx.clip('evenodd')
}

// ── HexagonCanvas ─────────────────────────────────────────────────────────────
const HexagonCanvas = forwardRef(function HexagonCanvas(
  { strokeModeRef, pacingCanvasRef, onTick, onGameStart, onResize, interactive },
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
      pacingStartRef.current       = performance.now()
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

  // ── HEXAGON-SPECIFIC: Pacing circle position with non-uniform side timing ──
  // Square uses uniform time per side, so fraction = (elapsed / CYCLE_MS) * 4.
  // Hexagon's 4s/4s/2s pattern means each side gets a different share of the
  // cycle: SIDE_DURATIONS_MS = [4000, 4000, 2000, 4000, 4000, 2000]. We map
  // elapsed → (sideIdx, sideProgress) by walking SIDE_START_MS, then compose
  // fraction = sideIdx + sideProgress for a value in [0, SIDES).
  function getPacing(elapsed) {
    const geo = geoRef.current
    if (!geo) return null
    const { sf, straightFrom, straightTo, arcCenters, arcStartAngles, r } = geo

    const t = elapsed % CYCLE_MS
    let sideIdx = SIDES - 1
    for (let i = 0; i < SIDES; i++) {
      if (t < SIDE_START_MS[i] + SIDE_DURATIONS_MS[i]) { sideIdx = i; break }
    }
    const sideProgress = (t - SIDE_START_MS[sideIdx]) / SIDE_DURATIONS_MS[sideIdx]
    const fraction     = sideIdx + sideProgress
    const s            = sideProgress

    if (s < sf) {
      const lt = s / sf
      const a  = straightFrom[sideIdx]
      const b  = straightTo[sideIdx]
      return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt, fraction }
    } else {
      const arcT  = (s - sf) / (1 - sf)
      const ac    = arcCenters[sideIdx]
      // Hexagon corner arc spans π/3 (exterior angle), CW in canvas coords
      const angle = arcStartAngles[sideIdx] + arcT * Math.PI / 3
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
        best = { dist: d, x: nx, y: ny, fraction: (i + t) / N * SIDES }
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
  // Given a starting fraction on the path (0–SIDES) and a target fraction, return
  // the position that is at most maxDist (CSS px) ahead of the start along the
  // path. If the gap is within maxDist, returns the target unchanged. If it
  // exceeds maxDist, walks forward and returns the capped position and fraction.
  // Handles the wrap-around at fraction SIDES→0.
  function advanceAlongPath(prevFrac, targetFrac, maxDist, points, totalPathLength) {
    const N = points.length - 1

    function fracToIndex(frac) {
      return Math.round((frac / SIDES) * N)
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
        const cappedFrac = (cappedIdx / N) * SIDES
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
    if (prev !== null && prev > SIDES - 0.3 && pos.fraction < 0.3) onLapComplete()
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

      const { cx, cy, R, r, lw } = geoRef.current
      const paintCtx = paintCanvas.getContext('2d')
      paintCtxRef.current = paintCtx

      // Hexagon paint clip — annular region between outer & inner hexagons.
      // Coordinates are in device pixels (the paint canvas matches main DPR).
      const clipArgs = {
        cx:          cx * dpr,
        cy:          cy * dpr,
        R:           R * dpr,
        cornerR:     r * dpr,
        lw:          lw * dpr,
        startAngle:  HEX_START_ANGLE,
      }
      clipArgsRef.current = clipArgs

      applyPaintClip(paintCtx, clipArgs)

      // Track geometry for the racetrack draw passes (CSS px, centerline).
      const trackGeo = {
        cx, cy, R,
        cornerR:    r,
        lw,
        startAngle: HEX_START_ANGLE,
      }
      trackGeoRef.current      = trackGeo
      trackGradientRef.current = buildTrackGradient(ctx, trackGeo)

      const color = getDriftColor(colorTimeRef.current)
      stampStroke.init({ paintCtx, lw, dpr, color })
      layeredWash.init({ paintCtx, lw, dpr, color, clipArgs })
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
      const { cx, cy, sq, lw, r } = geo
      const half = sq / 2  // legacy alias used by encouragement glow radius

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
        roundedNgonPath(ctx, trackGeo.cx, trackGeo.cy, trackGeo.R, SIDES,
                        trackGeo.cornerR, trackGeo.startAngle)
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
        // Hexagon's pacing rate is NON-UNIFORM across sides (4s/4s/2s pattern).
        // Compute the local rate based on whichever side the pacing circle is
        // currently on: 1 fraction-unit per SIDE_DURATIONS_MS[currentSide] ms.
        const pacingSideIdx = pacingPos
          ? Math.min(SIDES - 1, Math.floor(pacingPos.fraction))
          : 0
        const pacingRate = 1 / SIDE_DURATIONS_MS[pacingSideIdx]
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
          // Charge delay met, still racing — ramp gauge to 1 over 4s
          heatGaugeRef.current = Math.min(1, heatGaugeRef.current + dt / 4000)
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
          // Slowing/lifting before floor — drain gauge back over 2s, paint recovers
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 2000)
        } else if (gaugeActiveRef.current && goodPaceTimerRef.current >= GAUGE_DRAIN_DELAY) {
          // Floor reached; good pace held for 0.5s — drain over 2s, only saturation returns
          heatGaugeRef.current = Math.max(0, heatGaugeRef.current - dt / 2000)
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
        // Local pacing rate per current side — hexagon timing is non-uniform.
        const pacingSideIdx = Math.min(SIDES - 1, Math.floor(pacingPos.fraction))
        const speedRatio = childPathRateRef.current * SIDE_DURATIONS_MS[pacingSideIdx]
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

export default HexagonCanvas
