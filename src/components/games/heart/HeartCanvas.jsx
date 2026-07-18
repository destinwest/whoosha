// ── HeartCanvas.jsx ───────────────────────────────────────────────────────────
// Heart Breathing canvas — mirrors TriangleCanvas in mechanics but draws a
// classic heart outline (two rounded lobes converging to a bottom point) and
// splits the path at the exact vertical centerline into two 5s halves:
//   left half   cleft → bottom point (through the left lobe)  — breathe in
//   right half  bottom point → cleft (through the right lobe) — breathe out
// Total lap: 10 000ms.
//
// Most of this file is byte-identical to TriangleCanvas (heat gauge, synergy,
// embers, paint composite, touch bloom, fingerprint, pointer handling, etc.).
// Shape-specific divergences are flagged with "── HEART-SPECIFIC ──" headers.
// The heart's outline is a curve (6 mirrored cubic Beziers), not a straight-
// sided polygon, so it does NOT use roundedPolyPath/offsetPolygon — see
// buildGeo, buildHeartSegs, and the track-draw passes below for the direct
// bezier-path replacement.
//
// Props:
//   strokeModeRef  — { current: 'classic' | 'watercolor' }
//   pacingCanvasRef — ref to the overlay canvas above the saturate wrapper
//   onTick(now)    — called each rAF frame
//   onGameStart()  — called once when the child first drags from the start point
//   interactive    — boolean; controls pointer events on the canvas element
//
// No audio this pass (matches Triangle — see HeartGame).
//
// Imperative API (via ref):
//   reset()        — clears all canvas state and resets all game-state refs
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import * as stampStroke   from '../square/strokes/stampStroke'
import * as layeredWash   from '../square/strokes/layeredWash'

// ── HEART-SPECIFIC: shape + timing ───────────────────────────────────────────
const SIDES                 = 2   // left half (breathe in) / right half (breathe out)
const SIDE_DURATIONS_MS     = [5000, 5000]  // breathe-in / breathe-out
const CYCLE_MS              = SIDE_DURATIONS_MS.reduce((a, b) => a + b, 0)  // 10_000

// Cumulative start time for each side — used by getPacing to map elapsed→side.
const SIDE_START_MS = SIDE_DURATIONS_MS.reduce((acc, dur, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + SIDE_DURATIONS_MS[i - 1])
  return acc
}, [])

// ── HEART-SPECIFIC: unit-space path definition ───────────────────────────────
// A classic heart traced as 6 mirrored cubic Beziers, fitted to the user's
// reference SVG ("simple-rounded-heart-shape-outline", 2026-07-16). That icon's
// OUTER contour was parsed (its group transform translate(0,980) scale(0.1,-0.1)
// applied), its TRUE geometric anchors measured — lobe crown at the real min-y
// (|x|≈18.3, not the potrace segment junction ≈20.1 the first fit used) and
// widest at the real min-x (|x|≈42.2 @ y≈-12.7, not ≈-9.0) — and a cubic fitted
// per left-half arc (crown/widest via 4-pt interpolation; the long widest→bottom
// arc via endpoint tangents: vertical at the widest, horizontal at the tip).
// Right half is an exact mirror. See scratchpad analyze_heart.mjs, fit_heart.mjs,
// fit_heart2.mjs for the derivation and the SVG-overlay comparison.
//
// Coordinates are centered at (0,0), y-down, scaled to half-height 38. The key
// property vs. the previous version: the reference heart is WIDER THAN TALL
// (half-width 42.3 vs half-height 38, aspect 1.11) with full round lobes — the
// old track was narrower/taller (half-width 36), which pinched the lobes
// together and made the cleft read as a deep sharp gash. Widening the lobes
// opens the cleft into the broad shallow valley the reference shows.
//
// Traversal starts at the top-center cleft (the dip between the two lobes):
//   seg 0  cleft        → leftLobeTop   ┐
//   seg 1  leftLobeTop  → leftExtreme   ├─ LEFT HALF  (breathe in)
//   seg 2  leftExtreme  → bottom        ┘
//   seg 3  bottom       → rightExtreme  ┐
//   seg 4  rightExtreme → rightLobeTop  ├─ RIGHT HALF (breathe out)
//   seg 5  rightLobeTop → cleft         ┘
// Left/right halves are exact mirrors (x negated), so they have identical arc
// length — the fraction split at SIDES=2 lands exactly on the vertical
// centerline (cleft and bottom point), matching the design spec.
//
// The BOTTOM tip is rounded via a horizontal tangent (bottom arm 8): the two
// segments meeting there share a level tangent, so it reads as a filleted point
// rather than a spike.
//
// The CLEFT is deliberately tuned so the band's OUTER notch comes to a SHARP
// point, matching the reference SVG (user, 2026-07-16). The mechanism is
// non-obvious and easy to break, so: the band is drawn by STROKING this
// centerline with width lw, which offsets the outer edge TOWARD the cleft's
// center of curvature. So the outer notch radius = (centerline cleft radius) -
// lw/2. That gives three regimes:
//   radius >  lw/2  -> outer notch stays visibly rounded
//   radius ≈  lw/2  -> outer notch collapses to a sharp point   <-- what we want
//   radius <  lw/2  -> outer edge SELF-INTERSECTS and blunts itself (worse, not
//                      sharper — a naive "make it sharper" change lands here)
// The inner edge meanwhile gets radius + lw/2, i.e. a rounded bulge into the
// opening. That bulge is NOT an artifact — it is what any thick ring does at a
// sharp cleft, and the reference SVG has one too (its bulge ≈ its ring
// thickness). So no taper is needed.
//
// lw/2 in THIS unit space is (5.53 + 4/S), which drifts with screen scale S:
// ≈7.13 on a narrow phone, ≈6.86 at mobile, ≈6.03 on a large screen. The cleft
// below (y=-28.8, control arm toward the crown) is tuned to a radius of ≈7.23 —
// just above the worst case — so the notch is sharp on every size and never
// folds on small screens. Re-tune with scratchpad/tune_cleft.mjs if lw changes.
//
// The SAME radius-vs-lw/2 rule bites on the INNER edge, in the opposite sense.
// Wherever the centerline bends TOWARD the inside of the heart with radius <
// lw/2, the inner edge folds back through itself and the stroke fills the
// overlap — which reads as a hard CORNER on the inner edge while the outer edge
// stays smooth (user reported exactly this at the crown, 2026-07-16). So on any
// inward-bending stretch, keep radius comfortably > lw/2.
//
// That is why the crown (segs 0/1 and their mirrors 4/5) is G2-continuous, not
// just G1: both arcs are tuned to a COMMON crown radius of 24.39 — measured
// from the reference SVG's own crown — so curvature does not jump across the
// join (an earlier fit matched only tangents, leaving a 4.4x curvature jump and
// a radius of 4.83 that folded). Matching the SVG's real curvature also pulls
// the lobe CLOSER to the reference (max deviation 1.18u -> 0.28u). If you retune
// the crown, keep segs 0 and 1 sharing one radius and keep it > lw/2:
// scratchpad/fix_crown.mjs solves the control arms for both.
const HEART_UNIT_SEGS = [
  { p0: { x: 0, y: -28.8 }, c1: { x: -5.23, y: -30.57 }, c2: { x: -7.36, y: -37.98 }, p1: { x: -18.34, y: -37.98 } },
  { p0: { x: -18.34, y: -37.98 }, c1: { x: -32.44, y: -37.98 }, c2: { x: -42.76, y: -25.75 }, p1: { x: -42.16, y: -12.73 } },
  { p0: { x: -42.16, y: -12.73 }, c1: { x: -42.16, y: 9.26 }, c2: { x: -8, y: 38 }, p1: { x: 0, y: 38 } },
  { p0: { x: 0, y: 38 }, c1: { x: 8, y: 38 }, c2: { x: 42.16, y: 9.26 }, p1: { x: 42.16, y: -12.73 } },
  { p0: { x: 42.16, y: -12.73 }, c1: { x: 42.76, y: -25.75 }, c2: { x: 32.44, y: -37.98 }, p1: { x: 18.34, y: -37.98 } },
  { p0: { x: 18.34, y: -37.98 }, c1: { x: 7.36, y: -37.98 }, c2: { x: 5.23, y: -30.57 }, p1: { x: 0, y: -28.8 } },
]
const HEART_HALF_WIDTH  = 42.3  // unit-space half-width  (x: -42.3..42.3)
const HEART_HALF_HEIGHT = 38    // unit-space half-height (y: -38..38)
const STEPS_PER_SEG      = 60  // sample density per bezier segment

function cubicPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

// Scales+translates the unit-space segment list into pixel space — this is the
// CENTERLINE in pixels, nothing more.
//
// It used to take an `offsetPx` and fake the band's boundaries by scaling the
// whole heart about its centre. Don't bring that back: a radial scale displaces
// by offsetPx*(r/38), which only equals a perpendicular offset where r == 38, so
// the "boundaries" drifted (~24% short at the cleft, ~16% over at the widest)
// and the inner-wall shadow and paint clip sat off the visible edge. bandEdge()
// computes the real boundaries; use those.
function scaledHeartSegs(cx, cy, S) {
  return HEART_UNIT_SEGS.map(seg => ({
    p0: { x: cx + seg.p0.x * S, y: cy + seg.p0.y * S },
    c1: { x: cx + seg.c1.x * S, y: cy + seg.c1.y * S },
    c2: { x: cx + seg.c2.x * S, y: cy + seg.c2.y * S },
    p1: { x: cx + seg.p1.x * S, y: cy + seg.p1.y * S },
  }))
}

// Traces a heart's 6-segment bezier outline into the current path. Does NOT
// call beginPath()/closePath()'s stroke — caller controls that (mirrors
// roundedPolyPath's contract).
function heartPath(ctx, segs) {
  ctx.moveTo(segs[0].p0.x, segs[0].p0.y)
  for (const s of segs) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y)
  ctx.closePath()
}

// ── Constants ─────────────────────────────────────────────────────────────────
// Warm ivory/cream paint-trail palette (the traced line itself) — soft drift
// between near-white cream shades, per design spec (warm white/cream track,
// not the pink/red/purple/lavender accent palette used for particles/glow).
const LAP_COLORS = ['#FFFBF2', '#FDF0DE', '#FFF6E8', '#F7E9D3']

// Time for one full LAP_COLORS cycle in ms of active tracing.
// 72 000ms = ~72 seconds — roughly four laps at pacing speed.
const COLOR_CYCLE_MS = 72_000

// ── HEART-SPECIFIC: soft pink/red/purple/lavender accent palette ────────────
// Used for the touch bloom, fingerprint glow, pacing-circle glow, ember
// particles, synergy fill-color target, and encouragement glow — every place
// Triangle hardcodes its warm amber (212,160,86 / #D4A056) accent. Chosen to
// read as a cohesive pink/red/purple/lavender family against the salmon field
// and cream track.
const ACCENT_BLOOM_RGB   = '244,150,178'   // soft pink — touch bloom core
const ACCENT_GLOW_RGB    = '214,120,168'   // rose-purple — pacing/fingerprint glow
const ACCENT_EMBER_RGB   = '196,110,190'   // lavender-purple — ember particles
const ACCENT_SYNERGY_HEX = '#D8578F'       // rose-red — synergy fill target (was amber #D4A056)
const ACCENT_SYNERGY_RGB = {
  r: parseInt(ACCENT_SYNERGY_HEX.slice(1, 3), 16),
  g: parseInt(ACCENT_SYNERGY_HEX.slice(3, 5), 16),
  b: parseInt(ACCENT_SYNERGY_HEX.slice(5, 7), 16),
}
const ACCENT_ENC_RGB     = '196,130,196'   // lavender — encouragement glow

// ── Tracing core (groove model) ───────────────────────────────────────────────
// Ported from SquareCanvas. The user circle is a bead constrained to the path.
// Each frame the finger is projected onto the path by LOCAL search around the
// bead, then the bead moves to the projection if (a) the finger is within
// ACCEPTANCE perpendicular of the groove and (b) the projection is within LEASH
// arc-length of the bead. If either fails the bead is "not attached": it freezes
// and all game systems (heat gauge, synergy) drain toward default. The local
// search window is what prevents the bead teleporting to another edge of the
// shape when the finger strays near a different side.
const LEASH_TRACK_WIDTHS      = 1.4   // finger↔bead max arc-distance, in track widths
const ACCEPTANCE_TRACK_WIDTHS = 0.75  // finger↔groove max perpendicular distance, in track widths

// Lap validity: a seam crossing only counts as a lap once the bead has
// progressed at least this fraction of the way around the loop since the last.
const LAP_MIN_PROGRESS = 0.15   // 15% of a lap

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

// ── bandEdge ──────────────────────────────────────────────────────────────────
// The visible band is drawn by STROKING the centerline, so its true boundaries
// are the centerline perpendicular-offset by ±lw/2. They are NOT a scaled copy
// of the heart: scaledHeartSegs displaces RADIALLY by offsetPx*(r/38), which
// only equals a perpendicular offset where r == 38. Everywhere else it drifts —
// ~24% short at the cleft (r≈28.8), ~16% over at the widest (r≈44). The depth
// passes and the paint clip used to ride that scaled copy, so they sat off the
// edge the player actually sees. This returns the real edge instead.
//
// `d` is signed: + = outward (away from centre), − = inward. Two details make
// the result match what canvas actually strokes:
//   - The cleft is a real CORNER. On the OUTSIDE of that turn (the inner edge,
//     d < 0) the stroke leaves a gap that lineJoin fills, so we insert a round
//     arc to match TRACK_LINE_JOIN. On the INSIDE (the outer edge, d > 0) the
//     two offsets overlap and the union is a sharp point — the prune below
//     resolves that for free, which is what keeps the outer V.
//   - Wherever the centerline bends toward the offset side tighter than |d|
//     (the bottom tip, radius 3.34 < lw/2), the offset folds through itself.
//     Those points land inside the stroke and are pruned — that is exactly what
//     leaves the bottom V intact.
// O(n²) prune, but n≈360 and this runs once per RESIZE, never per frame.
function bandEdge(points, d, cx, cy) {
  const N = points.length - 1        // points[N] duplicates points[0] (closed)
  const P = points.slice(0, N)
  const n = P.length
  if (n < 8) return P
  const ad = Math.abs(d)
  // unit normal of segment a→b, flipped to always point AWAY from the centre
  const segNormal = (a, b, at) => {
    let tx = b.x - a.x, ty = b.y - a.y
    const L = Math.hypot(tx, ty) || 1
    tx /= L; ty /= L
    let nx = -ty, ny = tx
    if (nx * (at.x - cx) + ny * (at.y - cy) < 0) { nx = -nx; ny = -ny }
    return { x: nx, y: ny }
  }
  const E = []
  const off = (p, nn) => ({ x: p.x + nn.x * d, y: p.y + nn.y * d })
  // index 0 is the cleft corner — use one-sided normals, not a central diff
  const nIn  = segNormal(P[n - 1], P[0], P[0])
  const nOut = segNormal(P[0], P[1], P[0])
  E.push(off(P[0], nIn))
  if (d < 0) {
    // inner edge = outside of the turn → gap → round arc (matches lineJoin)
    const a0 = Math.atan2(nIn.y * d, nIn.x * d)
    const a1 = Math.atan2(nOut.y * d, nOut.x * d)
    let da = a1 - a0
    while (da >  Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.12))
    for (let k = 1; k < steps; k++) {
      const a = a0 + da * (k / steps)
      E.push({ x: P[0].x + Math.cos(a) * ad, y: P[0].y + Math.sin(a) * ad })
    }
  }
  E.push(off(P[0], nOut))
  for (let i = 1; i < n; i++) {
    E.push(off(P[i], segNormal(P[(i - 1 + n) % n], P[(i + 1) % n], P[i])))
  }
  // Drop offset points that landed inside the stroke (the fold loops). A valid
  // point sits |d| from its own centerline point and no closer to any other.
  const keep = []
  for (const q of E) {
    let m = Infinity
    for (const p of P) {
      const dd = Math.hypot(q.x - p.x, q.y - p.y)
      if (dd < m) { m = dd; if (m < ad * 0.9) break }
    }
    if (m >= ad * 0.9) keep.push(q)
  }
  return keep.length > 8 ? keep : E
}

// Traces a point-array edge (from bandEdge) into the current path. `k` scales
// into device px for the paint canvas.
function polyPath(ctx, pts, k = 1) {
  if (!pts || !pts.length) return
  ctx.moveTo(pts[0].x * k, pts[0].y * k)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * k, pts[i].y * k)
  ctx.closePath()
}

// ── buildGeo ──────────────────────────────────────────────────────────────────
// ── HEART-SPECIFIC: geometry ─────────────────────────────────────────────────
// Builds the centerline geometry for the heart track by sampling the 6-segment
// bezier outline (HEART_UNIT_SEGS) at pixel scale. Unlike Triangle's straight-
// plus-corner-arc split (sfArr), there's no separate "straight" vs "arc"
// portion here — the whole outline is curved, so points are simply sampled at
// uniform bezier-parameter steps per segment. Left half (segs 0-2, cleft →
// bottom point) and right half (segs 3-5, bottom point → cleft) are exact
// mirrors, so they have identical arc length and the fraction split at
// SIDES=2 lands exactly on the vertical centerline. Everything from cumLen
// onward is geometry-agnostic and identical to Triangle/Hexagon.
function buildGeo(rect) {
  const w  = rect.width
  const h  = rect.height
  const cx = w / 2
  const cy = h / 2

  // Uniform scale from unit heart-space (half-width 42.3, half-height 38) into
  // pixel space. FIT shrinks the whole heart to leave comfortable window margin
  // — the reference-matched shape is wider than before, and the user asked for
  // it ~15% smaller so it sits well inside the frame (2026-07-16).
  const FIT = 0.85
  const S = Math.min(w * 0.40 * FIT / HEART_HALF_WIDTH, h * 0.42 * FIT / HEART_HALF_HEIGHT)

  // "Circumradius"-equivalent size handle (half-height in pixel space) —
  // drives the track width using the same 0.0728 coefficient the other games
  // use on their own size handle, so lw / bead / pacing circle / bloom /
  // particles all match proportionally.
  const R       = S * HEART_HALF_HEIGHT
  const circleR = (2 * R) * 0.0728
  const lw      = circleR * 2 + 8

  // Pixel-space segment list for the track's centerline.
  const segs = scaledHeartSegs(cx, cy, S)

  // Sample N points along the path (STEPS_PER_SEG per segment, 6 segments),
  // indexed by fraction (0 → SIDES per lap). Segment 0 contributes its full
  // t=0..1 range; segments 1-5 skip their duplicate t=0 point (shared with
  // the previous segment's t=1 endpoint).
  const points = []
  HEART_UNIT_SEGS.forEach((seg, si) => {
    const pxSeg = segs[si]
    const startStep = si === 0 ? 0 : 1
    for (let step = startStep; step <= STEPS_PER_SEG; step++) {
      const t = step / STEPS_PER_SEG
      points.push(cubicPoint(pxSeg.p0, pxSeg.c1, pxSeg.c2, pxSeg.p1, t))
    }
  })
  const N = points.length - 1   // === 6 * STEPS_PER_SEG

  // Label placement — one per half, on each SIDE of the heart, vertically midway
  // between the topmost part of the arc and the bottom V. Within each half, pick
  // the sample whose y is closest to that midpoint (the descent down the outer
  // side crosses it exactly once; the crown ascent stays well above it), then
  // orient the label along the local track tangent so the text runs IN LINE with
  // the track — like the other games. The angle is normalized to ±90° so the
  // text stays upright while parallel to the curve (left reads "\", right "/",
  // mirror-symmetric). labelFracs are the lap-fraction (0 → SIDES) at those
  // points, so the proximity highlight peaks when the bead passes the label.
  let yTop = Infinity, yBot = -Infinity
  for (const p of points) { if (p.y < yTop) yTop = p.y; if (p.y > yBot) yBot = p.y }
  const labelTargetY = (yTop + yBot) / 2
  const halfLen = N / SIDES   // sample indices per half (=== 3 * STEPS_PER_SEG)

  const labelMids   = []
  const labelAngles = []
  const labelFracs  = []
  for (let s = 0; s < SIDES; s++) {
    const lo = s * halfLen
    const hi = (s + 1) * halfLen
    let bestIdx = lo, bestDy = Infinity
    for (let j = lo; j <= hi; j++) {
      const dy = Math.abs(points[j].y - labelTargetY)
      if (dy < bestDy) { bestDy = dy; bestIdx = j }
    }
    // Tangent from the flanking samples (clamped to the half), angle normalized
    // to ±90° so the label never reads upside down.
    const a = points[Math.max(lo, bestIdx - 1)]
    const b = points[Math.min(hi, bestIdx + 1)]
    let ang = Math.atan2(b.y - a.y, b.x - a.x)
    if (ang >  Math.PI / 2) ang -= Math.PI
    if (ang < -Math.PI / 2) ang += Math.PI
    labelMids.push(points[bestIdx])
    labelAngles.push(ang)
    labelFracs.push(bestIdx / halfLen)
  }

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

  // Track "size" handle returned for downstream callers that previously used
  // `sq` (Square's bounding-box side) — drives label font sizing etc. Use the
  // full pixel height (2×R) as the analogous "size" handle.
  const sq = 2 * R

  // The band's TRUE boundaries — what the stroke actually paints. The inner-wall
  // shadow and the paint clip both ride these so they land on the edge the
  // player sees (they used to ride a scaled copy and drifted off it). Computed
  // once here, per resize.
  const outerEdge = bandEdge(points, +lw / 2, cx, cy)
  const innerEdge = bandEdge(points, -lw / 2, cx, cy)

  return {
    cx, cy, sq, S, R, lw,
    segs,
    points, labelMids, labelAngles, labelFracs,
    outerEdge, innerEdge,
    cumLen, totalPathLength,
    sides: SIDES,
    w, h,
  }
}


// ── Racetrack draw passes (heart) ────────────────────────────────────────────
// trackGeo: { cx, cy, S, R, lw, segs, outerEdge, innerEdge } — CSS px.
// Retraced fresh each frame (cheap vector math, matches Triangle's per-frame
// roundedPolyPath retrace) with different widths/styles to build the layered
// "raised channel" effect. Warm cream tones (the track/stroke color per design
// spec) instead of Triangle's cool slate.
//
// The passes stack outward-in, and each one is anchored to the geometry it
// actually belongs to:
//   A drawTrackShadow    — strokes the CENTERLINE wider than the band, so the
//                          dark bleeds past the outer edge as a drop shadow.
//   B drawTrackBody      — strokes the CENTERLINE at lw. This IS the band, so
//                          its edges define the real boundaries.
//   D drawTrackInnerWall — strokes `innerEdge`, the band's REAL inner boundary
//                          from bandEdge(), seating the inner edge into the
//                          field. (Was a scaledHeartSegs copy, which drifted off
//                          that edge — see bandEdge for the numbers.)
// Anything that needs to sit ON an edge must use outerEdge/innerEdge, never a
// scaled copy of the heart.

// Called once per resize — returns a radial gradient for Pass B.
function buildTrackGradient(ctx, { cx, cy, R, lw }) {
  const innerR = Math.max(0, R * 0.5 - lw / 2)
  const outerR = R + lw / 2
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
  grad.addColorStop(0,   '#FFFBF3')   // inner edge — lightest warm cream
  grad.addColorStop(0.4, '#F7EBD9')   // base ivory
  grad.addColorStop(1,   '#E9D7BC')   // outer edge — deeper warm cream
  return grad
}

// ── lineJoin: why 'round' matters here ───────────────────────────────────────
// The centerline has ONE real corner: the cleft (a ~37° deflection). Canvas
// treats the two sides of a corner differently:
//   - INSIDE of the turn  = the OUTER edge here. The two offsets overlap and the
//     union gives a sharp point. lineJoin does NOT affect it, so the outer V
//     stays sharp no matter what.
//   - OUTSIDE of the turn = the INNER edge here. There's a gap, and lineJoin
//     fills it: 'miter' (canvas's DEFAULT) puts an angular point there, 'round'
//     puts a smooth arc.
// So 'round' is what keeps the inner boundary free of angles while leaving the
// outer V untouched (user, 2026-07-16: smooth the inner boundary, keep the
// outer V sharp). Leaving lineJoin unset silently gets 'miter' and the angle
// comes back.
// The bottom tip's inner V is NOT a join — it comes from the inner offset
// folding (radius 3.34 < lw/2), and the centerline is smooth there — so it
// survives 'round' untouched, which is what we want.
const TRACK_LINE_JOIN = 'round'

// Pass A — outer shadow: bleeds outside track footprint, soft drop shadow.
function drawTrackShadow(ctx, { segs, lw }) {
  ctx.save()
  ctx.beginPath()
  heartPath(ctx, segs)
  ctx.lineWidth   = lw + 7
  ctx.lineJoin    = TRACK_LINE_JOIN
  ctx.strokeStyle = 'rgba(120,60,70,0.20)'
  ctx.stroke()
  ctx.restore()
}

// Pass B — gradient body: main cream surface.
function drawTrackBody(ctx, { segs, lw }, trackGradient) {
  ctx.save()
  ctx.beginPath()
  heartPath(ctx, segs)
  ctx.lineWidth   = lw
  ctx.lineJoin    = TRACK_LINE_JOIN
  ctx.strokeStyle = trackGradient ?? '#F7EBD9'
  ctx.stroke()
  ctx.restore()
}

// Pass D — inner wall shadow: faint dark line seating the track's inner edge
// into the field. Rides `innerEdge` — the band's REAL inner boundary — so it
// sits exactly on the visible edge. It used to stroke a scaledHeartSegs copy,
// which drifted off that edge by ~24% of lw/2 at the cleft and ~16% at the
// widest (see bandEdge). Round join for the same reason the body uses one.
function drawTrackInnerWall(ctx, { innerEdge, lw }) {
  ctx.save()
  ctx.beginPath()
  polyPath(ctx, innerEdge)
  ctx.lineWidth   = lw * 0.18
  ctx.lineJoin    = TRACK_LINE_JOIN
  ctx.strokeStyle = 'rgba(120,60,70,0.13)'
  ctx.stroke()
  ctx.restore()
}

// ── applyPaintClip ────────────────────────────────────────────────────────────
// Applies a permanent annular clip — the band itself — so painted strokes can
// never bleed outside the track channel. Rides the band's REAL boundaries
// (bandEdge), traced in CSS px and scaled by `dpr` to the paint canvas's device
// pixels. Previously this used scaledHeartSegs copies offset +lw/2 / −lw, which
// (a) drifted off the visible edge and (b) let the clip run a full lw/2 PAST the
// inner edge, so paint could show inside the heart's opening.
// save() is intentionally never restored — the clip persists.
function applyPaintClip(ctx, { outerEdge, innerEdge, dpr }) {
  if (!outerEdge || !innerEdge) return
  ctx.save()
  ctx.beginPath()
  polyPath(ctx, outerEdge, dpr)
  polyPath(ctx, innerEdge, dpr)
  ctx.clip('evenodd')
}

// ── Groove tracing core (pure helpers) ────────────────────────────────────────
// Ported from SquareCanvas. These operate purely on geo (points, cumLen, sides)
// + scalars — no refs, no canvas.

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

// Inverse of lerpCumLen: the fractional index whose arc-length is `s`.
// Needed because HeartCanvas's points are sampled at uniform BEZIER-PARAMETER
// steps (STEPS_PER_SEG per segment), not uniform arc-length — a cubic bezier's
// speed (d(arc-length)/dt) varies along its length (fastest through the flatter
// mid-lobe stretch, slowest through the tightly-curved cleft/tip), so equal
// steps in index-space are NOT equal steps in pixel-space. Any caller that
// wants constant PIXEL speed over time (the pacing dot) must walk cumLen
// (arc-length), not the raw index, then convert back to an index/position via
// this lookup — binary search since cumLen is monotonic increasing.
function idxAtLen(cumLen, s) {
  const N = cumLen.length - 1
  if (s <= 0) return 0
  if (s >= cumLen[N]) return N
  let lo = 0, hi = N
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumLen[mid] < s) lo = mid + 1
    else hi = mid
  }
  const i = Math.max(0, lo - 1)
  const segLen = cumLen[i + 1] - cumLen[i]
  const t = segLen > 0 ? (s - cumLen[i]) / segLen : 0
  return i + t
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

// Project (px,py) onto the path, searching ONLY segments whose start is within
// `windowPx` arc-length of `centerIdx` (local search — this is the leash that
// stops the bead jumping to another side of the shape). Returns
// { idx, x, y, perpDist } of the nearest point, or null if the window is empty.
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
    if (!best || d < best.perpDist) {
      best = { idx: i + t, x: nx, y: ny, perpDist: d }
    }
  }
  return best
}

// Global nearest projection (whole path) — used only for the very first/re-touch,
// where there is no bead to search around.
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

// ── HeartCanvas ───────────────────────────────────────────────────────────────
const HeartCanvas = forwardRef(function HeartCanvas(
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

  // ── Game state refs ────────────────────────────────────────────────────────
  const pacingStartRef       = useRef(null)    // clock for pacing circle — starts at mount
  const gameStartRef         = useRef(null)
  const startedRef           = useRef(false)
  const touchRef             = useRef(false)
  const childPosRef          = useRef(null)
  const lapCountRef          = useRef(0)   // laps completed — used only for encouragement gate
  const colorTimeRef         = useRef(0)   // ms of active tracing time — drives color drift
  const prevFracRef          = useRef(null)
  const beadIdxRef           = useRef(null)     // bead position as a float index into geo.points
  const fingerPosRef         = useRef(null)     // latest finger pixel pos {x,y}, set by pointer handlers
  const tracingRef           = useRef(false)    // bead attached + following this frame (drives gauge/synergy)
  const passedLapCheckpointRef = useRef(false)  // bead crossed LAP_MIN_PROGRESS forward since last lap
  const pacingPosRef         = useRef(null)
  const lastEncouragementRef = useRef(-Infinity)
  const encouragementRef     = useRef(null)
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
      prevFracRef.current          = null
      beadIdxRef.current           = null
      fingerPosRef.current         = null
      tracingRef.current           = false
      passedLapCheckpointRef.current = false
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

  // ── Pacing circle position ─────────────────────────────────────────────────
  // Uniform 5s/5s timing, so each half gets an equal share of the cycle. We
  // map elapsed → (sideIdx, sideProgress) by walking SIDE_START_MS, then compose
  // fraction = sideIdx + sideProgress for a value in [0, SIDES). Unlike
  // Triangle (straight segment + corner arc needing sfArr), the heart's whole
  // outline is one continuous curve, so the pixel position is read directly
  // off the pre-sampled points/cumLen via the geometry-agnostic pointAt() —
  // fraction/SIDES maps onto arc-length (via idxAtLen), NOT the raw sample
  // index — the index range [0, N] is uniform in bezier-parameter, not pixel
  // distance, so index-linear mapping made the dot visibly speed up through
  // the flatter mid-lobe stretch and slow through the tightly-curved
  // cleft/tip. Arc-length is what actually reads as "constant speed" on
  // screen, and both halves have identical arc length (mirror symmetry), so
  // time-linear-in-arc-length gives a true constant-speed traversal.
  function getPacing(elapsed) {
    const geo = geoRef.current
    if (!geo) return null
    const { points, cumLen, totalPathLength } = geo

    const t = elapsed % CYCLE_MS
    let sideIdx = SIDES - 1
    for (let i = 0; i < SIDES; i++) {
      if (t < SIDE_START_MS[i] + SIDE_DURATIONS_MS[i]) { sideIdx = i; break }
    }
    const sideProgress = (t - SIDE_START_MS[sideIdx]) / SIDE_DURATIONS_MS[sideIdx]
    const fraction     = sideIdx + sideProgress
    const s            = (fraction / SIDES) * totalPathLength
    const idx          = idxAtLen(cumLen, s)
    const pos          = pointAt(points, idx)
    return { x: pos.x, y: pos.y, fraction }
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
    // Normalize both ends into [0, N-1]. points[N] === points[0] geometrically,
    // so mapping N → 0 is correct and avoids painting the entire track at the seam.
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

  // The bead-advance math lives per-frame in the rAF loop (see the tracing block
  // there). These handlers only place the bead on first/re-touch and record the
  // latest raw finger position; the leash/acceptance gating is decoupled from
  // pointer-event delivery rate.
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
      // lands (global projection) so the user can resume ANYWHERE on the path. A
      // touch well off the track is a silent no-op (same acceptance window).
      const proj = projectGlobal(geo, px, py)
      if (!proj || proj.perpDist > geo.lw * ACCEPTANCE_TRACK_WIDTHS) return  // off-track: ignore

      // Reposition the bead and reset seam/lap tracking so the jump can't
      // register a spurious lap.
      beadIdxRef.current             = proj.idx
      const frac                     = fractionAt(geo, proj.idx)
      prevFracRef.current            = frac
      passedLapCheckpointRef.current = false
      childPosRef.current            = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: frac }
      lastTouchRef.current           = { x: proj.x, y: proj.y }  // avoids a teleport-sized velocity/particle spike
      addStrokePoint(proj.x, proj.y, 0)  // pen was lifted on pointerUp → fresh stroke at the new point

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
      g.addColorStop(0,   `rgba(250,180,205,${(particleAlpha * 0.9).toFixed(3)})`)
      g.addColorStop(0.5, `rgba(${ACCENT_EMBER_RGB},${(particleAlpha * 0.5).toFixed(3)})`)
      g.addColorStop(1,   `rgba(${ACCENT_EMBER_RGB},0)`)
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

      // Pacing-circle overlay canvas — same dimensions and DPR as main canvas
      const pacingCanvas = pacingCanvasRef?.current
      if (pacingCanvas) {
        pacingCanvas.width  = rect.width  * dpr
        pacingCanvas.height = rect.height * dpr
      }
      geoRef.current     = buildGeo(rect)
      onResize?.({ labelMids: geoRef.current.labelMids, labelAngles: geoRef.current.labelAngles, sq: geoRef.current.sq })

      const { cx, cy, S, R, lw } = geoRef.current
      const paintCtx = paintCanvas.getContext('2d')
      paintCtxRef.current = paintCtx

      // Heart paint clip — the band itself, from its real boundaries. The edges
      // are CSS px; the paint canvas is device px, so pass dpr and let
      // applyPaintClip scale as it traces. (lw stays for layeredWash's init.)
      const clipArgs = {
        outerEdge: geoRef.current.outerEdge,
        innerEdge: geoRef.current.innerEdge,
        dpr,
        lw: lw * dpr,
      }
      clipArgsRef.current = clipArgs

      applyPaintClip(paintCtx, clipArgs)

      // Track geometry for the racetrack draw passes (CSS px). `segs` is the
      // centerline (stroked for the shadow + body); outerEdge/innerEdge are the
      // band's real boundaries, used by the inner-wall pass. R stays for the
      // radial track gradient.
      const trackGeo = {
        cx, cy, S, R,
        lw,
        segs: geoRef.current.segs,
        outerEdge: geoRef.current.outerEdge,
        innerEdge: geoRef.current.innerEdge,
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
      const { cx, cy, sq, lw } = geo
      const half = sq / 2  // legacy alias used by encouragement glow radius

      // ── Heat gauge effect — written by gauge block each frame, read here ────
      const gaugeEffect = gaugeEffectRef.current

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 1. Racetrack — three passes ───────────────────────────────────────
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
      if (pacingPos) {
        pacingPosRef.current = pacingPos
      }

      // ── Bead tracing (per-frame, leash + acceptance) ──────────────────────
      // Move the bead toward the finger along the groove, or freeze it if the
      // finger has left the leash/acceptance window. tracingRef is the single
      // "actively tracing" signal the gauge + synergy consume: attached →
      // systems evaluate live; detached (lift, off-track, or leash-snap) →
      // systems drain toward default. The LOCAL search is what stops the bead
      // teleporting across the shape to a different side.
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

          // Commit bead position before lap detection.
          beadIdxRef.current  = newIdx
          childPosRef.current = { x: proj.x, y: proj.y, clx: proj.x, cly: proj.y, fraction: newFrac }

          // Lap detection — a seam crossing only counts once the bead has
          // progressed past the lap checkpoint forward since the previous lap.
          const prevFrac   = prevFracRef.current
          const checkpoint = LAP_MIN_PROGRESS * geo.sides
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
      if (startedRef.current && tracingRef.current) {
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
        // Local pacing rate = 1 fraction-unit per SIDE_DURATIONS_MS[side] ms.
        // Uniform (3s) here, but kept per-side so uneven timing needs no change.
        const pacingSideIdx = pacingPos
          ? Math.min(SIDES - 1, Math.floor(pacingPos.fraction))
          : 0
        const pacingRate = 1 / SIDE_DURATIONS_MS[pacingSideIdx]
        const speedRatio = childPathRateRef.current / pacingRate

        const isTooFast  = tracingRef.current && speedRatio > GAUGE_SPEED_THRESHOLD
        const isGoodPace = !tracingRef.current || speedRatio <= GAUGE_SPEED_THRESHOLD

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
        const isTrulyRacing = tracingRef.current && speedRatio > GAUGE_RECOVER_THRESHOLD
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
      //   - Not tracing (lifted/off-track) OR gauge-floor active → fast return
      //     to 0 over 3s (from max). Both events should drain the reward.
      //   - Tracing + on-pace                → accumulator grows at +dt.
      //   - Tracing + off-pace               → symmetric 1:1 slow decay.
      if (!tracingRef.current || gaugeActiveRef.current) {
        onPaceAccumRef.current = Math.max(
          0, onPaceAccumRef.current - dt * SYNERGY_RETURN_RATE,
        )
      } else if (startedRef.current && pacingPos && childPosRef.current) {
        const child      = childPosRef.current
        const dist       = Math.hypot(child.clx - pacingPos.x, child.cly - pacingPos.y)
        // Local pacing rate per current side (uniform, but kept per-side).
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

          // Stage 0→1 grows the pink bloom toward pacing-circle size;
          // stage 2→3 then grows BOTH circles to 1.5× original pacing size.
          const synergyScale = (1 + 0.55 * synStage01) * (1 + 0.5 * synStage23)
          const innerR = lw * 0.4 * bloomScale * synergyScale
          const outerR = lw * 1.1 * bloomScale * synergyScale

          // One gradient — disk body (0 → 36% of outerR = innerR) + soft halo.
          // The "disk character" emerges with synergy: at synStage01=0 the
          // curve stays soft (subtle pre-synergy bloom); at synStage01=1 the
          // disk reads as solid rose-pink matching the pacing circle's size
          // and opacity. 36% mark is always at innerR (ratio 0.4/1.1 is fixed).
          if (outerR > 0.5) {
            const sb       = synStage01  // 0 → 1: shifts from soft glow to solid disk
            const aMid     = (0.55 + 0.20 * sb) * alpha   // 18% radius
            const aDiskEdge = (0.20 + 0.38 * sb) * alpha  // 36% radius (edge of innerR / "disk edge")
            const aHaloA   = (0.08 + 0.14 * sb) * alpha   // 55% radius
            const aHaloB   = (0.02 + 0.04 * sb) * alpha   // 80% radius

            const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, outerR)
            grad.addColorStop(0,    `rgba(255,205,222,${(0.85 * alpha).toFixed(3)})`)
            grad.addColorStop(0.18, `rgba(${ACCENT_BLOOM_RGB},${aMid.toFixed(3)})`)
            grad.addColorStop(0.36, `rgba(230,140,175,${aDiskEdge.toFixed(3)})`)
            grad.addColorStop(0.55, `rgba(${ACCENT_GLOW_RGB},${aHaloA.toFixed(3)})`)
            grad.addColorStop(0.80, `rgba(${ACCENT_GLOW_RGB},${aHaloB.toFixed(3)})`)
            grad.addColorStop(1,    `rgba(${ACCENT_GLOW_RGB},0)`)
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

          // Warm glow underneath — vivid rose-purple, brightness scales with emphasis
          if (emph > 0.01) {
            const glowR = r * 1.5
            const glow  = pacingCtx.createRadialGradient(
              pacingPos.x, pacingPos.y, r * 0.5,
              pacingPos.x, pacingPos.y, glowR,
            )
            glow.addColorStop(0, `rgba(${ACCENT_GLOW_RGB},${(0.45 * emph).toFixed(3)})`)
            glow.addColorStop(1, `rgba(${ACCENT_GLOW_RGB},0)`)
            pacingCtx.beginPath()
            pacingCtx.arc(pacingPos.x, pacingPos.y, glowR, 0, Math.PI * 2)
            pacingCtx.fillStyle = glow
            pacingCtx.fill()
          }

          // The circle itself — translucent so the start-state fingerprint
          // shows through; lifts to more solid at full emphasis (gauge floor).
          // Synergy stage 1→2 lerps the fill from white toward ACCENT_SYNERGY_HEX.
          const fillAlpha = 0.55 + 0.30 * emph
          const fillR = Math.round(255 - (255 - ACCENT_SYNERGY_RGB.r) * synStage12)
          const fillG = Math.round(255 - (255 - ACCENT_SYNERGY_RGB.g) * synStage12)
          const fillB = Math.round(255 - (255 - ACCENT_SYNERGY_RGB.b) * synStage12)
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
          grad.addColorStop(0, `rgba(240,175,220,${alpha.toFixed(3)})`)
          grad.addColorStop(1, `rgba(${ACCENT_EMBER_RGB},0)`)
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
          glow.addColorStop(0, `rgba(${ACCENT_GLOW_RGB},${(0.22 * (1 - dismissT)).toFixed(3)})`)
          glow.addColorStop(1, `rgba(${ACCENT_GLOW_RGB},0)`)
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
          grad.addColorStop(0, `rgba(${ACCENT_ENC_RGB},${(alpha * 0.3).toFixed(3)})`)
          grad.addColorStop(1, `rgba(${ACCENT_ENC_RGB},0)`)
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
          ctx.fillText('Beautiful work', cx, cy)
          ctx.restore()
        } else {
          encouragementRef.current = null
        }
      }

      ctx.restore()

      // ── Label proximity — write CSS vars for DOM overlay ──────────────────
      // Driven by the pacing circle's ACTUAL fraction (from getPacing). Unlike
      // Triangle (straight side + corner-arc approach, needing sfArr), the
      // heart has no straight/arc split — each half is one continuous curve —
      // so proximity is simply a symmetric falloff around each label's own
      // half-midpoint (fraction i + 0.5): full through most of its half,
      // smoothly fading near the cleft/bottom-point boundary with the other
      // half.
      if (pacingPos) {
        const lpBlend = smoothstep(startedRef.current
          ? Math.min(1, (now - gameStartRef.current) / BLEND_MS)
          : 0)

        for (let i = 0; i < SIDES; i++) {
          const target = geoRef.current.labelFracs?.[i] ?? (i + 0.5)
          let dist = Math.abs(pacingPos.fraction - target)
          if (dist > SIDES / 2) dist = SIDES - dist
          const proximity = 1 - smoothstep(Math.min(1, dist / 0.85))
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

export default HeartCanvas
