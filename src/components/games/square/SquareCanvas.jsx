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
import { createHeatGauge } from '../_shared/heatGauge'
import { createSynergy }   from '../_shared/synergy'

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

// ── Tracing core (groove model) ───────────────────────────────────────────────
// The user circle is a bead constrained to the path. Each frame the finger is
// projected onto the path by LOCAL search around the bead, then the bead moves
// to the projection if (a) the finger is within ACCEPTANCE perpendicular of the
// groove and (b) the projection is within LEASH arc-length of the bead. If
// either fails the bead is "not attached": it freezes and all game systems
// (heat gauge, synergy) drain toward default. Both checks are symmetric in
// direction, which is also what prevents corner-cutting in either winding.
//
// LEASH is the heart of the trace UX: how far the finger may lead/lag the bead
// before the groove lets go. Larger = more forgiving of fast/loose tracing;
// smaller = stricter, more intentional. ACCEPTANCE is how far sideways off the
// groove the finger may stray before it counts as off-track.
const LEASH_TRACK_WIDTHS      = 1.4   // finger↔bead max arc-distance, in track widths
const ACCEPTANCE_TRACK_WIDTHS = 0.75  // finger↔groove max perpendicular distance, in track widths

// Lap validity: a seam crossing only counts as a lap if, since the last lap,
// the bead has progressed at least this fraction of the way around the loop
// (a checkpoint just past the seam-bounce zone). Prevents wiggling across the
// seam from inflating the lap count. Detected by a forward crossing of the
// checkpoint fraction, so merely being near the seam can't trip it.
const LAP_MIN_PROGRESS = 0.15   // 15% of a lap

// ── Heat gauge tuning ─────────────────────────────────────────────────────────
// Consumed by the shared createHeatGauge state machine (see _shared/heatGauge).
// speedThreshold is also referenced directly by the synergy block below, so
// it stays a named const.
const GAUGE_SPEED_THRESHOLD = 1.2   // path rate ratio above which gauge charges
const GAUGE_CONFIG = {
  speedThreshold:   GAUGE_SPEED_THRESHOLD,
  recoverThreshold: 3.0,    // ratio above which the recovery timer resets (true racing)
  chargeDelayMs:    500,    // sustained too-fast before the gauge starts ramping
  drainDelayMs:     250,    // sustained good-pace before recovery begins (post-floor)
  rampUpMs:         2000,   // gauge 0 → 1 ramp duration
  rampDownMs:       1000,   // gauge 1 → 0 drain duration
  effectThreshold:  0.3,    // gauge value below which no visible effect appears
}

// ── Synergy tuning ────────────────────────────────────────────────────────────
// Time-based continuous reward. An on-pace accumulator grows while the user
// stays close + in pace and decays when they drift. Stage 0→4 is mapped
// directly from the accumulator via piecewise-linear thresholds.
// SYNERGY_DIST_THRESHOLD_LW stays here — it's combined with lw (geometry) to
// compute the "close" boolean the synergy machine consumes. The stage timings
// and drain rate are config for the shared createSynergy machine.
const SYNERGY_DIST_THRESHOLD_LW = 0.8     // user within lw * 0.8 of pacing counts as close
const SYNERGY_CONFIG = {
  // durations (ms) for stages 0→1, 1→2, 2→3, 3→4
  //   stage 1 — amber grows to pacing size
  //   stage 2 — pacing fill shifts to amber
  //   stage 3 — both circles grow to 1.5×
  //   stage 4 — embers begin radiating
  stageTimesMs: [4000, 4000, 8000, 16000],
  returnMs:     3000,   // full drain from max when finger lifts / gauge floors
}

// ── Encouragement messages ────────────────────────────────────────────────
// Pool of phrases that may appear on a successful close-tracked lap
// completion. Selection rules:
//   1. Normal trigger: random pick from pool, excluding the most recently
//      shown message (so back-to-back duplicates can't happen).
//   2. Recovery trigger: if the user fully activated the heat gauge
//      (gaugeActive = true) and then recovered, the next message is
//      forced to RECOVERY_MESSAGE, acknowledging the return.
const ENCOURAGEMENT_MESSAGES = [
  'Beautiful work 🌟',
  'You\'re doing great 🌱',
  '🌬️ Breathing well',
  'That\'s the way 🌙',
  'Lovely breath 🌸',
  '🍃 Right on pace',
  'Peace 🕊️',
  'That feels better 💚',
]

// Specific message shown the next time encouragement fires after the user
// has fully activated the heat gauge and then recovered. Also in the
// general pool so it can appear naturally even without prior dysregulation.
const RECOVERY_MESSAGE = 'That feels better 💚'

const EMBER_PARTICLE_CAP        = 30
const EMBER_SPAWN_RATE_AT_FULL  = 14      // particles per second at Stage 4.0
const ALPHA_ACTIVE = 0.75
const ALPHA_FLOOR  = 0.18
export const SCALE_ACTIVE = 2.0   // peak label scale as the pacing circle arrives — base is 1.0, so +100% growth
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

  // Cumulative arc-length at each point index (cumLen[0] = 0,
  // cumLen[N] = totalPathLength). The groove tracing core measures
  // finger-to-bead distance ALONG the path, and points are sampled by
  // parameter (not uniform arc-length), so we need real cumulative lengths.
  const cumLen = new Array(N + 1)
  cumLen[0] = 0
  for (let i = 0; i < N; i++) {
    cumLen[i + 1] = cumLen[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  const totalPathLength = cumLen[N]

  return {
    cx, cy, sq, half, lw, r, sf,
    arcCenters, arcStartAngles,
    straightFrom, straightTo,
    points, labelMids,
    cumLen, totalPathLength,
    sides: 4,
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

// ── Groove tracing core (pure helpers) ────────────────────────────────────────
// These operate purely on geo (points, cumLen, sides) + scalars — no refs, no
// canvas. They are the to-be-extracted "module 3" path math, written here first
// so the new tracing core can be felt-tested on Square before extraction.

// Signed shortest arc distance (px) from index a to index b around the closed
// loop. Positive = b is forward of a. Indices are floats in [0, N].
function arcGapPx(geo, aIdx, bIdx) {
  const { cumLen, totalPathLength } = geo
  const a = lerpCumLen(cumLen, aIdx)
  const b = lerpCumLen(cumLen, bIdx)
  let d = b - a
  if (d >  totalPathLength / 2) d -= totalPathLength
  if (d < -totalPathLength / 2) d += totalPathLength
  return d
}

// Cumulative arc-length at a fractional index (linear within the segment).
function lerpCumLen(cumLen, idx) {
  const N = cumLen.length - 1
  const i = Math.max(0, Math.min(N - 1, Math.floor(idx)))
  const t = idx - i
  return cumLen[i] + (cumLen[i + 1] - cumLen[i]) * t
}

// Pixel position at a fractional index.
function pointAt(points, idx) {
  const N = points.length - 1
  const i = Math.max(0, Math.min(N - 1, Math.floor(idx)))
  const t = idx - i
  const a = points[i]
  const b = points[i + 1]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// Fraction (0..sides) at a fractional index.
function fractionAt(geo, idx) {
  const N = geo.points.length - 1
  return (idx / N) * geo.sides
}

// Project (px,py) onto the path, searching ONLY segments whose midpoint is
// within `windowPx` arc-length of `centerIdx` (local search — required for
// self-passing paths). Returns { idx, x, y, perpDist } of the nearest point,
// or null if the window is empty. Handles loop wraparound.
function projectLocal(geo, centerIdx, px, py, windowPx) {
  const { points, cumLen, totalPathLength } = geo
  const N = points.length - 1
  const centerLen = lerpCumLen(cumLen, centerIdx)

  let best = null
  for (let i = 0; i < N; i++) {
    // Arc distance from centerLen to this segment's start, wrapped.
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
    if (!best || d < best.perpDist) {
      best = { idx: i + t, x: nx, y: ny, perpDist: d }
    }
  }
  return best
}

// Global nearest projection (whole path) — used only for the very first touch,
// where there is no bead yet to search around.
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
    if (!best || d < best.perpDist) {
      best = { idx: i + t, x: nx, y: ny, perpDist: d }
    }
  }
  return best
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
  const touchRef             = useRef(false)    // finger/mouse is down
  const childPosRef          = useRef(null)     // bead pixel position {x,y,clx,cly,fraction}
  // ── Groove tracing core state ──
  const beadIdxRef           = useRef(null)     // bead position as a float index into geo.points
  const fingerPosRef         = useRef(null)     // latest finger pixel pos {x,y}, set by pointer handlers
  const tracingRef           = useRef(false)    // bead attached + following this frame (drives gauge/synergy)
  const lapCountRef          = useRef(0)   // laps completed — used only for encouragement gate
  const colorTimeRef         = useRef(0)   // ms of active tracing time — drives color drift
  const prevFracRef          = useRef(null)
  const pacingPosRef         = useRef(null)
  const lastEncouragementRef        = useRef(-Infinity)
  const lastEncouragementMessageRef = useRef(null)   // anti-repeat memory — never pick this message twice in a row
  const encouragementRef            = useRef(null)
  const passedLapCheckpointRef      = useRef(false)  // bead crossed LAP_MIN_PROGRESS forward since last lap
  const recoveredFromDysregRef      = useRef(false)  // set true when gaugeActive flips true→false; consumed by next encouragement
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
  // The state machine (value, timers, active flag) lives in the shared
  // createHeatGauge module. gaugeActiveRef + gaugeEffectRef bridge its
  // per-frame result out to the draw code and the onGameStateTick snapshot,
  // which read them in many places.
  const gaugeMachineRef      = useRef(null)
  if (!gaugeMachineRef.current) gaugeMachineRef.current = createHeatGauge(GAUGE_CONFIG)
  const gaugeActiveRef       = useRef(false) // true once desaturation has fully fired
  const gaugeEffectRef       = useRef(0)     // eased effect strength, read by draw loop
  const childPathRateRef     = useRef(0)     // path fraction-units/ms, smoothed
  const pacingEmphasisRef    = useRef(0)     // 0–1, eased toward gaugeActive — drives pacing-circle grow + glow
  // ── Synergy reward (time-based continuous progression) ────────────────────
  // Accumulator + stage curve live in the shared createSynergy module.
  // synergyStageRef bridges its per-frame result out to the draw code and the
  // onGameStateTick snapshot.
  const synergyMachineRef    = useRef(null)
  if (!synergyMachineRef.current) synergyMachineRef.current = createSynergy(SYNERGY_CONFIG)
  const synergyStageRef      = useRef(0)     // 0.0 → 4.0, read by draw loop + snapshot
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
      beadIdxRef.current           = null
      fingerPosRef.current         = null
      tracingRef.current           = false
      prevFracRef.current          = null
      gameStartRef.current         = null
      // See START_AT_BREATH_PHASE — shift the reference time back so elapsed
      // begins at the desired breath-phase fraction rather than at 0.
      pacingStartRef.current       = performance.now() - START_AT_BREATH_PHASE * CYCLE_MS
      lapCountRef.current          = 0
      colorTimeRef.current         = 0
      lastEncouragementRef.current        = -Infinity
      lastEncouragementMessageRef.current = null
      encouragementRef.current            = null
      passedLapCheckpointRef.current      = false
      recoveredFromDysregRef.current      = false

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

      gaugeMachineRef.current.reset()
      gaugeActiveRef.current      = false
      gaugeEffectRef.current      = 0
      childPathRateRef.current    = 0
      pacingEmphasisRef.current   = 0
      synergyMachineRef.current.reset()
      synergyStageRef.current     = 0
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

  // ── paintBeadSegment ───────────────────────────────────────────────────────
  // Paint the groove from one bead index to another by walking the intermediate
  // path points, so the stroke follows corners exactly (no chord-cutting). The
  // stroke modules interpolate stamps between successive points internally.
  function paintBeadSegment(geo, fromIdx, toIdx) {
    const { points } = geo
    const N = points.length - 1
    const color = getDriftColor(colorTimeRef.current)
    stampStroke.updateColor(color)
    layeredWash.updateColor(color)

    const gap = arcGapPx(geo, fromIdx, toIdx)   // signed, short direction
    const dir = gap >= 0 ? 1 : -1
    // Normalize both ends into [0, N-1]. Math.round(toIdx) can equal N (at the
    // seam, when toIdx ≥ N-0.5), but the walked index lives in [0, N-1], so an
    // un-normalized `end === N` never matches → the loop would run all N steps
    // and paint the ENTIRE track. points[N] === points[0] geometrically, so
    // mapping N → 0 is correct.
    let i     = Math.round(fromIdx) % N
    const end = Math.round(toIdx) % N
    let steps = 0
    while (i !== end && steps < N) {
      i = ((i + dir) % N + N) % N
      addStrokePoint(points[i].x, points[i].y, 0)
      steps++
    }
    const ep = pointAt(points, toIdx)
    addStrokePoint(ep.x, ep.y, 0)
  }

  function onLapComplete() {
    lapCountRef.current++
    const now    = performance.now()
    const pacing = pacingPosRef.current
    const child  = childPosRef.current
    if (pacing && child) {
      const dist = Math.hypot(child.clx - pacing.x, child.cly - pacing.y)
      if (lapCountRef.current > 1 && dist <= 60 && now - lastEncouragementRef.current > 45_000) {
        let message
        if (recoveredFromDysregRef.current) {
          // Recovery override: the user fully activated the heat gauge and
          // came back. Acknowledge the return specifically.
          message = RECOVERY_MESSAGE
          recoveredFromDysregRef.current = false
        } else {
          // Normal pick: random from the pool, excluding the most recently
          // shown message so back-to-back duplicates can't happen.
          const last = lastEncouragementMessageRef.current
          const candidates = last
            ? ENCOURAGEMENT_MESSAGES.filter((m) => m !== last)
            : ENCOURAGEMENT_MESSAGES
          message = candidates[Math.floor(Math.random() * candidates.length)]
        }
        encouragementRef.current            = { startTime: now, message }
        lastEncouragementRef.current        = now
        lastEncouragementMessageRef.current = message
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

  // ── Pointer handlers ──────────────────────────────────────────────────────
  // The handlers only record intent: where the finger is and whether it's down.
  // ALL bead motion, painting, lap detection, and the gauge/synergy "tracing"
  // signal are computed once per frame in the bead-update block of the rAF loop
  // (using the latest finger position), so the feel is frame-rate independent
  // and decoupled from pointer-event delivery rate.

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return

    fingerPosRef.current = { x: px, y: py }

    if (!startedRef.current) {
      // First touch must land on the path to begin. Global projection finds
      // where on the groove the user started; the bead is placed there.
      const proj = projectGlobal(geo, px, py)
      if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return  // silent reject

      startedRef.current   = true
      gameStartRef.current = performance.now()
      touchRef.current     = true
      onGameStart?.()

      beadIdxRef.current   = proj.idx
      const frac           = fractionAt(geo, proj.idx)
      prevFracRef.current  = frac
      childPosRef.current  = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: frac }
      addStrokePoint(proj.x, proj.y, 0)
      startPressureRamp()

      fingerprintActiveRef.current = false
      fpDismissingRef.current      = true
      fpDismissTRef.current        = 0
      touchActiveRef.current       = true
      lastTouchRef.current         = { x: proj.x, y: proj.y }
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
      // Re-touch after a lift. Snap the bead to wherever on the track the finger
      // lands (global projection, exactly like the first touch) so the user can
      // resume ANYWHERE on the path — no need to grab the old frozen spot and
      // race to catch the pacing circle. A touch well off the track is a silent
      // no-op (same acceptance window as the first touch), so a stray tap won't
      // yank the circle.
      const proj = projectGlobal(geo, px, py)
      if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return  // off-track: ignore

      // Reposition the bead and reset seam/lap tracking so the jump can't
      // register a spurious lap: prevFrac starts at the new spot, and the lap
      // checkpoint must be re-crossed forward from here.
      beadIdxRef.current             = proj.idx
      const frac                     = fractionAt(geo, proj.idx)
      prevFracRef.current            = frac
      passedLapCheckpointRef.current = false
      childPosRef.current            = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: frac }
      lastTouchRef.current           = { x: proj.x, y: proj.y }  // avoids a teleport-sized velocity/particle spike
      addStrokePoint(proj.x, proj.y, 0)  // pen was lifted on pointerUp → starts a fresh stroke at the new point

      touchRef.current       = true
      startPressureRamp()
      touchActiveRef.current = true
      bloomFadingRef.current = false
      bloomFadeRef.current   = 1
      cancelAnimationFrame(bloomFadeRafRef.current)
      startBloomAttack()
    }
  }

  function onPointerMove(px, py) {
    if (!touchRef.current) return
    fingerPosRef.current = { x: px, y: py }
  }

  function onPointerUp() {
    touchRef.current         = false
    touchActiveRef.current   = false
    tracingRef.current       = false
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

      // ── Bead tracing core ─────────────────────────────────────────────────
      // Move the bead toward the finger along the groove, or freeze it if the
      // finger has left the leash/acceptance window. tracingRef is the single
      // "actively tracing" signal the gauge + synergy consume as their
      // "touching" input: attached → systems evaluate live; detached (lift,
      // off-track, or leash-snap) → systems drain toward default.
      tracingRef.current = false
      if (startedRef.current && touchRef.current && fingerPosRef.current && beadIdxRef.current !== null) {
        const fp       = fingerPosRef.current
        const leashPx  = geo.lw * LEASH_TRACK_WIDTHS
        const acceptPx = geo.lw * ACCEPTANCE_TRACK_WIDTHS
        const proj     = projectLocal(geo, beadIdxRef.current, fp.x, fp.y, leashPx)

        if (proj && proj.perpDist <= acceptPx) {
          // Attached — advance the bead to the finger's projection.
          const prevIdx = beadIdxRef.current
          const newIdx  = proj.idx
          const newFrac = fractionAt(geo, newIdx)

          // Bead arc-velocity (fraction-units/ms), smoothed — gauge speedRatio.
          const gapFrac = (arcGapPx(geo, prevIdx, newIdx) / geo.totalPathLength) * geo.sides
          if (dt > 0) {
            childPathRateRef.current = childPathRateRef.current * 0.5 + (Math.abs(gapFrac) / dt) * 0.5
          }

          // Paint the groove between old and new bead index (corner-correct).
          paintBeadSegment(geo, prevIdx, newIdx)

          // Commit bead position before lap detection (onLapComplete reads it).
          beadIdxRef.current  = newIdx
          childPosRef.current = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: newFrac }

          // Lap detection. A seam crossing (high fraction → low fraction)
          // only counts once the bead has progressed past the lap checkpoint
          // forward since the previous lap — so wiggling across the seam can't
          // inflate the count. The checkpoint flag is set by a *forward
          // crossing* of LAP_MIN_PROGRESS·sides (not by merely being beyond
          // it, which would be true near the seam too).
          const prevFrac     = prevFracRef.current
          const checkpoint   = LAP_MIN_PROGRESS * geo.sides
          if (prevFrac !== null && prevFrac < checkpoint && newFrac >= checkpoint) {
            passedLapCheckpointRef.current = true
          }
          if (
            prevFrac !== null &&
            prevFrac > geo.sides - 0.3 &&
            newFrac < 0.3 &&
            passedLapCheckpointRef.current
          ) {
            onLapComplete()
            passedLapCheckpointRef.current = false
          }
          prevFracRef.current = newFrac

          // Feed bloom/particle trackers from bead motion.
          const prevTouch = lastTouchRef.current
          lastTouchRef.current = { x: proj.x, y: proj.y }
          if (prevTouch) {
            const ddx = proj.x - prevTouch.x, ddy = proj.y - prevTouch.y
            const len = Math.hypot(ddx, ddy)
            if (len > 0.5) {
              trackTangentRef.current = { x: ddx / len, y: ddy / len }
              if (dt > 0) fingerSpeedRef.current = fingerSpeedRef.current * 0.7 + (len / dt) * 0.3
              lastTouchTimeRef.current = now   // particle speed-decay gate
            }
          }

          tracingRef.current = true
        }
      }
      if (!tracingRef.current) {
        // Not attached — bead frozen; path rate decays so the gauge reads good pace.
        childPathRateRef.current = 0
      }

      // ── Color drift ───────────────────────────────────────────────────────
      // Advance timer only while actively tracing; compute color every frame
      // so stamps always use the current drifted value.
      if (tracingRef.current) {
        colorTimeRef.current += dt
      }
      if (startedRef.current) {
        const driftColor = getDriftColor(colorTimeRef.current)
        stampStroke.updateColor(driftColor)
        layeredWash.updateColor(driftColor)
      }

      // ── Heat gauge update ─────────────────────────────────────────────────
      // State machine lives in the shared createHeatGauge module. Square's
      // pacing rate is constant (4 fraction-units per lap per CYCLE_MS), so
      // speedRatio is a simple division. The module returns the frame's
      // gauge state + two edge-trigger flags handled below.
      if (startedRef.current) {
        const pacingRate = 4 / CYCLE_MS
        const speedRatio = childPathRateRef.current / pacingRate

        const r = gaugeMachineRef.current.update(dt, {
          speedRatio,
          touching: tracingRef.current,   // attached-and-tracing, not merely finger-down
        })

        // Bridge the result out to the refs the draw code + snapshot read.
        gaugeActiveRef.current = r.gaugeActive
        gaugeEffectRef.current = r.gaugeEffect

        // justHitFloor → clear the paint canvas permanently (re-clipped).
        if (r.justHitFloor) {
          stampStroke.clear()
          if (paintCtxRef.current && clipArgsRef.current) {
            applyPaintClip(paintCtxRef.current, clipArgsRef.current)
          }
        }

        // justRecovered → flag the next encouragement as "that feels better".
        if (r.justRecovered) {
          recoveredFromDysregRef.current = true
        }

        // Drain saturation toward grayscale — the color drains from the world.
        document.documentElement.style.setProperty(
          '--game-saturation', (1 - r.gaugeEffect * 0.9).toFixed(3),
        )
      }

      // ── Synergy update ────────────────────────────────────────────────────
      // Accumulator + stage curve live in the shared createSynergy module.
      // The canvas computes the geometry-dependent inputs (close / in-pace /
      // can-evaluate) and the module returns the continuous stage.
      {
        let close = false, inPace = false
        const canEvaluate = startedRef.current && pacingPos && childPosRef.current
        if (canEvaluate) {
          const child      = childPosRef.current
          const dist       = Math.hypot(child.clx - pacingPos.x, child.cly - pacingPos.y)
          const speedRatio = childPathRateRef.current / (4 / CYCLE_MS)
          close  = dist <= lw * SYNERGY_DIST_THRESHOLD_LW
          inPace = speedRatio <= GAUGE_SPEED_THRESHOLD
        }
        synergyStageRef.current = synergyMachineRef.current.update(dt, {
          touching:    tracingRef.current,   // attached-and-tracing, not merely finger-down
          gaugeActive: gaugeActiveRef.current,
          canEvaluate,
          close,
          inPace,
        })
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
        const t = (now - enc.startTime) / 2_600   // total lifetime (ms)
        if (t < 1) {
          // Envelope: ease in (0→18%), hold (18→35%), ease out (35→100%).
          // smoothstep on each ramp keeps the bloom gentle at both ends.
          let alpha
          if      (t < 0.18) alpha = smoothstep(t / 0.18)
          else if (t < 0.35) alpha = 1
          else               alpha = smoothstep(1 - (t - 0.35) / 0.65)
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
          ctx.fillText(enc.message, cx, cy)
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
