// ── nightSky.js ───────────────────────────────────────────────────────────────
// Shared night-sky bake. Currently used by the STAR game's background (and
// mulberry32 is shared with Infinity's lakeSurface.js). History: born in the
// Infinity game, moved to _shared/ when Star adopted the same sky (2026-07-14);
// Infinity then moved on to its own lake-surface background the same day
// (infinity/lakeSurface.js), leaving Star as the sky's sole consumer. The seed
// is fixed, so every bake is pixel-identical across resizes and consumers.

// ── mulberry32 ────────────────────────────────────────────────────────────────
// Tiny seeded PRNG so the baked star field is identical across re-bakes (resize).
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── buildNightSkyBg ───────────────────────────────────────────────────────────
// Bakes the whole static night sky — deep-blue base, purple/gold nebulae, a soft
// Milky Way band, and a seeded star field — into one offscreen canvas at device
// resolution. Per-frame cost at runtime: zero (drawn as a bitmap). Follows the
// iOS rules: bake at resize, composite as bitmap, no per-frame filters.
export function buildNightSkyBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base wash — deep midnight navy, a touch of violet toward the lower-middle.
  const base = ctx.createLinearGradient(0, 0, w * 0.4, h)
  base.addColorStop(0.0,  '#070A22')
  base.addColorStop(0.35, '#0E1235')
  base.addColorStop(0.62, '#181A47')
  base.addColorStop(0.82, '#221A48')
  base.addColorStop(1.0,  '#0B0C28')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Screen-blend phase — glows brighten what's below (nebulae + Milky Way).
  ctx.globalCompositeOperation = 'screen'

  // Milky Way band — several overlapping soft glows along a gentle diagonal,
  // pale blue-white, so a hazy river of light runs behind the figure.
  const bandFrom = { x: w * 0.30, y: -h * 0.10 }
  const bandTo   = { x: w * 0.72, y: h * 1.10 }
  const bandSteps = 7
  for (let i = 0; i <= bandSteps; i++) {
    const t  = i / bandSteps
    const px = bandFrom.x + (bandTo.x - bandFrom.x) * t
    const py = bandFrom.y + (bandTo.y - bandFrom.y) * t
    const r  = Math.max(w, h) * 0.28
    const g  = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0,   'rgba(150,160,220,0.09)')
    g.addColorStop(0.5, 'rgba(120,130,200,0.05)')
    g.addColorStop(1,   'rgba(120,130,200,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Nebula pockets — purple, magenta, and gold clouds at low alpha.
  for (const { cx, cy, rf, color } of [
    { cx: 0.28, cy: 0.22, rf: 0.42, color: 'rgba(110,80,180,0.16)' },   // violet, upper-left
    { cx: 0.74, cy: 0.34, rf: 0.34, color: 'rgba(150,80,160,0.12)' },   // magenta, upper-right
    { cx: 0.62, cy: 0.72, rf: 0.40, color: 'rgba(120,90,190,0.13)' },   // violet, lower
    { cx: 0.34, cy: 0.80, rf: 0.30, color: 'rgba(200,160,90,0.10)' },   // gold, lower-left
    { cx: 0.52, cy: 0.48, rf: 0.26, color: 'rgba(210,175,95,0.07)' },   // faint gold, center
  ]) {
    const px = cx * w, py = cy * h, r = rf * Math.max(w, h)
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Star field — seeded scatter. Most are tiny; a handful are bright with a soft
  // halo and, for the brightest, a faint golden twinkle spike.
  const rand = mulberry32(0x5EED8)
  const starCount = Math.round((w * h) / 5500)   // density scales with area
  for (let i = 0; i < starCount; i++) {
    const x  = rand() * w
    const y  = rand() * h
    const rr = rand()
    const radius = 0.4 + rr * rr * 1.8            // biased small
    const bright = 0.35 + rand() * 0.6

    // Star tint — mostly white, some pale gold / pale blue.
    const pick = rand()
    let col
    if      (pick < 0.15) col = `255,238,200`    // pale gold
    else if (pick < 0.30) col = `205,220,255`    // pale blue
    else                  col = `255,255,255`    // white

    if (radius > 1.4) {
      // Bright star — soft halo.
      const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.5)
      halo.addColorStop(0,   `rgba(${col},${(bright * 0.5).toFixed(3)})`)
      halo.addColorStop(1,   `rgba(${col},0)`)
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(x, y, radius * 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = `rgba(${col},${bright.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()

    // Occasional golden twinkle spike on the very brightest.
    if (radius > 1.55 && rand() < 0.5) {
      const spike = radius * 5
      ctx.strokeStyle = `rgba(255,235,190,${(bright * 0.35).toFixed(3)})`
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(x - spike, y); ctx.lineTo(x + spike, y)
      ctx.moveTo(x, y - spike); ctx.lineTo(x, y + spike)
      ctx.stroke()
    }
  }

  ctx.globalCompositeOperation = 'source-over'
  return oc
}
