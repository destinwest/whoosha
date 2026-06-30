// ── dandelionSprite ──────────────────────────────────────────────────────────
// Bakes a single round, soft "fluff" puff to an offscreen canvas ONCE, then
// caches it. Every particle is a scaled drawImage of this bitmap — per-frame
// vector cost is zero (honors POLISH-STRATEGY rule 7: bake static content).
//
// The softness comes from four layered passes drawn at high resolution:
//   1. a wide diffuse halo  — the airy outer cotton body
//   2. ~76 fine faint filaments at 360° — soft down, not distinct spokes
//   3. ~60 scattered downy specks — the cotton-ball texture
//   4. a soft bright core — a gentle off-white center
//
// Tuned in prototypes/dandelion-transition.html (the design reference).

const SPRITE_PX = 80

let cached = null

export function getDandelionSprite() {
  if (cached) return cached

  const oc = document.createElement('canvas')
  oc.width = oc.height = SPRITE_PX
  const c = oc.getContext('2d')
  const S = SPRITE_PX
  const cx = S / 2
  const cy = S / 2
  const Rout = S * 0.46 // outer reach of the fluff

  // 1 ── diffuse outer glow — a wide, dense soft halo (the airy cotton body)
  const halo = c.createRadialGradient(cx, cy, 0, cx, cy, Rout)
  halo.addColorStop(0, 'rgba(255,255,255,0.55)')
  halo.addColorStop(0.45, 'rgba(255,255,255,0.34)')
  halo.addColorStop(0.78, 'rgba(255,255,255,0.12)')
  halo.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = halo
  c.beginPath()
  c.arc(cx, cy, Rout, 0, Math.PI * 2)
  c.fill()

  // 2 ── many fine, faint filaments at 360° — dense + thin so they read as
  // soft down rather than distinct spokes. No hard barbs.
  c.lineCap = 'round'
  const N = 76
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.14
    const len = Rout * (0.8 + 0.18 * Math.random()) // rounder, even edge
    const ex = cx + Math.cos(a) * len
    const ey = cy + Math.sin(a) * len
    c.strokeStyle = `rgba(255,255,255,${0.18 + Math.random() * 0.22})`
    c.lineWidth = 0.7
    c.beginPath()
    c.moveTo(cx, cy)
    c.lineTo(ex, ey)
    c.stroke()
  }

  // 3 ── scattered downy specks — tiny soft blobs across the disc give the
  // cotton-ball texture that makes it read as fluff, not a starburst.
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2
    const rr = Rout * (0.2 + 0.72 * Math.sqrt(Math.random()))
    const px = cx + Math.cos(a) * rr
    const py = cy + Math.sin(a) * rr
    const br = S * (0.018 + 0.03 * Math.random())
    const sg = c.createRadialGradient(px, py, 0, px, py, br)
    sg.addColorStop(0, `rgba(255,255,255,${0.3 + Math.random() * 0.3})`)
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = sg
    c.beginPath()
    c.arc(px, py, br, 0, Math.PI * 2)
    c.fill()
  }

  // 4 ── soft bright core — a gentle, slightly off-white center
  const core = c.createRadialGradient(cx, cy, 0, cx, cy, Rout * 0.46)
  core.addColorStop(0, 'rgba(255,255,255,0.80)')
  core.addColorStop(0.6, 'rgba(252,250,242,0.40)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = core
  c.beginPath()
  c.arc(cx, cy, Rout * 0.46, 0, Math.PI * 2)
  c.fill()

  cached = oc
  return cached
}
