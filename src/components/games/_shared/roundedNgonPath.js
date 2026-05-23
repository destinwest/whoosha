// ── roundedNgonPath ──────────────────────────────────────────────────────────
// Traces a rounded regular N-gon path on the given canvas context. Used by the
// shape games (square, hexagon, octagon, …) for both the racetrack draw passes
// and the paint-canvas clip. Replaces ctx.roundRect's role in SquareCanvas.
//
//   ctx          — CanvasRenderingContext2D
//   cx, cy       — center of the polygon, in CSS px
//   radius       — distance from center to each vertex (the circumradius)
//   sides        — number of sides/vertices (>= 3). 4 = square, 6 = hexagon, etc.
//   cornerRadius — corner-rounding radius. Each vertex becomes an arc of this
//                  radius; straight edges connect tangent points of adjacent
//                  arcs. Pass 0 for a sharp polygon.
//   startAngle   — angle of the first vertex, in radians. 0 places the first
//                  vertex on the +x axis (to the right of center). Increase
//                  rotates counter-clockwise in math coords; in canvas coords
//                  (where +y goes down) the rotation appears clockwise on
//                  screen because the y-axis is flipped.
//
// Does NOT call beginPath(); the caller controls that so the path can be
// composed for clipping or stroking with other geometry. Ends with closePath().
//
// Orientation notes for common shapes:
//   • Axis-aligned square (default Square game): sides=4, startAngle=π/4
//   • Flat-top hexagon  (top/bottom horizontal): sides=6, startAngle=π/3
//   • Pointy-top hexagon (vertices at top/bot.):  sides=6, startAngle=π/2
//
// Example — outline a flat-top hexagon as a stroked track:
//   ctx.beginPath()
//   roundedNgonPath(ctx, cx, cy, R, 6, R * 0.18, Math.PI / 3)
//   ctx.lineWidth   = lw
//   ctx.strokeStyle = '#F5EFE6'
//   ctx.stroke()
//
// Example — paint-canvas clip (annular: outer minus inner):
//   ctx.beginPath()
//   roundedNgonPath(ctx, cx, cy, outerR, sides, outerCr, startAngle)
//   roundedNgonPath(ctx, cx, cy, innerR, sides, innerCr, startAngle)
//   ctx.clip('evenodd')
export function roundedNgonPath(ctx, cx, cy, radius, sides, cornerRadius, startAngle = 0) {
  if (sides < 3) return

  // Compute vertex positions on the circumcircle
  const verts = []
  const step  = (Math.PI * 2) / sides
  for (let i = 0; i < sides; i++) {
    const a = startAngle + i * step
    verts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
  }

  // Sharp polygon — straight lines between vertices, no arcs
  if (cornerRadius <= 0) {
    ctx.moveTo(verts[0].x, verts[0].y)
    for (let i = 1; i < sides; i++) ctx.lineTo(verts[i].x, verts[i].y)
    ctx.closePath()
    return
  }

  // Start at the midpoint of edge 0 so the first arcTo's implicit line segment
  // covers half of edge 0 cleanly. closePath() then connects from the final
  // corner's tangent point back to this midpoint along edge 0's straight run.
  const startMidX = (verts[0].x + verts[1].x) / 2
  const startMidY = (verts[0].y + verts[1].y) / 2
  ctx.moveTo(startMidX, startMidY)

  // Walk corners. arcTo(corner, nextMid, r) draws:
  //   1. a straight segment from current pen position to the tangent point on
  //      the edge entering `corner`
  //   2. the corner arc itself, ending at the tangent point on the edge from
  //      `corner` toward `nextMid`
  for (let i = 1; i <= sides; i++) {
    const corner = verts[i % sides]
    const next   = verts[(i + 1) % sides]
    const nextMidX = (corner.x + next.x) / 2
    const nextMidY = (corner.y + next.y) / 2
    ctx.arcTo(corner.x, corner.y, nextMidX, nextMidY, cornerRadius)
  }

  ctx.closePath()
}
