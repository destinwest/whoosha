// ── roundedPolyPath ───────────────────────────────────────────────────────────
// Traces a rounded, arbitrary (convex) polygon path from an explicit vertex
// list, rounding every corner with the same radius via arcTo. Use it when
// side lengths differ, so a single-circumradius regular-ngon model no longer
// describes the shape (e.g. the Hexagon game's shortened "hold" sides). The
// drawn track then follows the exact same vertices the pacing/trace
// centerline is built from, keeping the visible track welded to the
// traceable path.
//
//   ctx          — CanvasRenderingContext2D
//   verts        — array of { x, y } vertices in draw order (>= 3), CSS or
//                  device px depending on the target context
//   cornerRadius — corner-rounding radius (px). Pass <= 0 for a sharp polygon.
//
// Does NOT call beginPath(); the caller controls that so the path can be
// composed for clipping (see offsetPolygon + evenodd) or stroking. Ends with
// closePath().
export function roundedPolyPath(ctx, verts, cornerRadius) {
  const n = verts.length
  if (n < 3) return

  // Sharp polygon — straight lines between vertices, no arcs.
  if (cornerRadius <= 0) {
    ctx.moveTo(verts[0].x, verts[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(verts[i].x, verts[i].y)
    ctx.closePath()
    return
  }

  // Start at the midpoint of edge 0 so the first arcTo's implicit line segment
  // covers half of edge 0 cleanly; closePath() connects the final corner's
  // tangent point back to this midpoint along edge 0's straight run.
  const startMidX = (verts[0].x + verts[1].x) / 2
  const startMidY = (verts[0].y + verts[1].y) / 2
  ctx.moveTo(startMidX, startMidY)

  for (let i = 1; i <= n; i++) {
    const corner = verts[i % n]
    const next   = verts[(i + 1) % n]
    const nextMidX = (corner.x + next.x) / 2
    const nextMidY = (corner.y + next.y) / 2
    ctx.arcTo(corner.x, corner.y, nextMidX, nextMidY, cornerRadius)
  }

  ctx.closePath()
}

// ── offsetPolygon ─────────────────────────────────────────────────────────────
// Returns a new vertex array offset perpendicular to every edge by `d` px:
// d > 0 pushes each edge outward (away from the polygon centroid), d < 0 pushes
// inward. New vertices are the intersections of adjacent offset edges — the
// standard convex-polygon offset. Used to build the track's inner-wall stroke
// and the annular paint clip (outer poly minus inner poly) around the irregular
// hexagon centerline.
//
// When feeding the result to roundedPolyPath, adjust the corner radius the same
// way you adjust the polygon: cornerRadius + d for the outward poly,
// cornerRadius + d (d negative) for the inward one — clamped to >= 0.
export function offsetPolygon(verts, d) {
  const n = verts.length

  // Centroid — orients "outward" consistently for any winding order.
  let cx = 0, cy = 0
  for (const v of verts) { cx += v.x; cy += v.y }
  cx /= n; cy /= n

  // Offset line per edge i (verts[i] → verts[i+1]): a point on the shifted edge
  // plus the edge direction.
  const lines = []
  for (let i = 0; i < n; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % n]
    const ex = b.x - a.x
    const ey = b.y - a.y
    let nx = -ey
    let ny =  ex
    const len = Math.hypot(nx, ny) || 1
    nx /= len; ny /= len
    // Flip the normal to point outward (away from centroid) if needed.
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny }
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, dx: ex, dy: ey })
  }

  // New vertex i = intersection of offset edge (i-1) and offset edge (i).
  const out = []
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n]
    const L2 = lines[i]
    const denom = L1.dx * L2.dy - L1.dy * L2.dx
    if (Math.abs(denom) < 1e-9) {
      // Parallel adjacent edges — fall back to the offset point of L2.
      out.push({ x: L2.px, y: L2.py })
      continue
    }
    const t = ((L2.px - L1.px) * L2.dy - (L2.py - L1.py) * L2.dx) / denom
    out.push({ x: L1.px + t * L1.dx, y: L1.py + t * L1.dy })
  }
  return out
}
