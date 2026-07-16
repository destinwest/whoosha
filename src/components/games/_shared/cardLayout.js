// ── cardLayout ────────────────────────────────────────────────────────────────
// Single source of truth for how big each game's track renders on its home-
// carousel card, and where it sits vertically. Every *CardPreview.jsx reads
// these instead of guessing its own size/position ratios — previously each
// shape's size ratio was tuned in isolation (square 0.70, hexagon 0.39/0.45,
// triangle 0.414/0.345, star 0.34/0.30, infinity 0.78), so apparent size
// varied ~2x between the smallest (star) and largest (infinity) card.
//
// The fix: every shape computes its own UNIT bounding box (the shape's extent
// at R/sq/widthC = 1, via the exact same vertex-building function used to
// draw it — see each file's buildVerts), then fitWithMargin() below solves
// for the size that keeps the shape's *painted* extent — its path bounding
// box PLUS the stroke, which extends lineWidth/2 beyond the centerline path
// on every side — at least MARGIN_PX clear of the card's edges and the
// title. (An earlier version fit only the invisible centerline path to a
// percentage of the card, which ignored the stroke entirely — since lw is a
// meaningful fraction of the shape at these sizes, that let some shapes'
// visible tracks run almost to the card edge.)

export const CARD_W = 200
export const CARD_H = 280

// The title sits at top:86% of the card (GameCarousel.jsx), vertically
// centered via translateY(-50%) on its own line box — an 18px/leading-tight
// (1.25) single-line title, ≈22.5px tall. Top edge of that text block, as a
// fraction of card height:
export const TITLE_TOP_RATIO = 0.86 - (22.5 / 2) / CARD_H   // ≈ 0.8198

// Fixed pixel clearance between the shape's painted (stroke-inclusive) edge
// and every card edge, and between the shape and the title.
export const MARGIN_PX = 20

// The shape is centered in the region from the card's top edge down to the
// title, inset by MARGIN_PX on both sides — which collapses to exactly
// TITLE_TOP/2, independent of the margin, since both insets are equal.
export const REGION_CENTER_RATIO = TITLE_TOP_RATIO / 2

// Per-shape perceptual-weight fudge factor — a cheap stand-in for true
// ink-area matching (which would need exact fill-area integration per
// shape). Applied as a final multiplier on top of the margin-safe fit, so
// weight > 1 deliberately eats a little into the margin (a shape that reads
// thin/sparse at its margin-safe size) and weight < 1 gives some back (a
// shape that reads "fuller" than its bounding box suggests — e.g. hexagon's
// near-flat sides run close to its box edge all the way around, while
// triangle/star's pointed geometry leaves visible empty space inside the
// same box, so hexagon reads bigger at an identical bbox). Tuned by eye
// against a side-by-side screenshot, not derived — adjust freely if a shape
// still reads big/small next to the others.
export const SHAPE_VISUAL_WEIGHT = {
  square:   1.00,
  hexagon:  0.99,   // solid, near-flat sides read "fuller" than its bbox — pulled back
                    // from 1.00, then +15% per user request (0.86 → 0.989)
  triangle: 1.24,   // 1.5R-tall vs. 1.73R-wide — proportionally shorter than a 1:1 square
                    // at the same width, so it reads smaller even at an identical margin —
                    // then +15% per user request (1.08 → 1.242)
  star:     1.32,   // ten slim points + a slimmed track read smaller than their bbox —
                    // then +15% per user request (1.15 → 1.3225)
  infinity: 1.08,   // thin ribbon curve, most of its bbox is empty space
  heart:    1.02,   // two rounded lobes read close to full — near-square weight
}

// Bounding box of a vertex list, plus its own centroid (which may not be the
// (0,0) the vertices were built around — e.g. triangle's apex-up geometry is
// taller above its center than below).
export function bboxOf(verts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of verts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

// Solve for a shape's own size parameter S (sq for square, R for hexagon/
// triangle/star, widthC for infinity) such that its PAINTED extent —
// betaW·S / betaH·S (the path bbox, in units of S) plus lw = m·S + c (the
// shape's own track-width formula, also in units of S) — clears MARGIN_PX
// on both the width and the region-height dimensions. lw is affine in S, so
// this solves in closed form: betaW·S + m·S + c = avail → S = (avail−c)/(betaW+m).
// The tighter (smaller) of the two candidate S values wins — same
// "object-fit: contain" logic as before, now stroke-aware. `weight` is
// applied last (see SHAPE_VISUAL_WEIGHT above).
export function fitWithMargin(w, h, betaW, betaH, m, c, weight = 1) {
  const availW = w - 2 * MARGIN_PX
  const availH = h * TITLE_TOP_RATIO - 2 * MARGIN_PX
  const sW = (availW - c) / (betaW + m)
  const sH = (availH - c) / (betaH + m)
  return Math.min(sW, sH) * weight
}

// Center (cx, cy) to build a shape's final verts at, so that its bbox
// (computed from the unit verts) lands exactly centered in the card: cx on
// the card's horizontal center, cy on the region center above the title.
export function fitCenter(w, h, unitBBox, S) {
  return {
    cx: w / 2 - unitBBox.cx * S,
    cy: h * REGION_CENTER_RATIO - unitBBox.cy * S,
  }
}
