// ── dandelionField ───────────────────────────────────────────────────────────
// The transient particle system for the card → game transition. A faithful port
// of prototypes/dandelion-transition.html. Everything lives on ONE full-screen
// canvas that the caller mounts only during the transition and tears down after
// (so the single-overlay perf budget is respected — this layer does not persist
// into gameplay).
//
// Four beats, driven by one rAF loop:
//   bloom   — seeds emit from the tapped card's rect and spread to fill the screen
//   peak    — near-full whiteout (dense field + white veil); caller navigates
//             the live game in BEHIND the cover via onPeak()
//   blow    — a directional wind sweeps the seeds off-screen (onBlow() fires the
//             breath whoosh), revealing the now-mounted game
//   done    — onDone() when the field is empty; caller unmounts the overlay
//
// DPR-aware (rule 6). The seed sprite is baked once (see dandelionSprite.js).

import { getDandelionSprite } from './dandelionSprite'

// Tuning dialed in with the user (mirrors the prototype's confirmed defaults).
export const DANDELION_PARAMS = {
  count: 1400, // seed count
  emit: 1200, // emission window (ms)
  drift: 75, // bloom spread speed cap (px/s)
  lift: 120, // updraft / buoyancy
  swirl: 100, // bloom swirl strength
  size: 14, // base seed size (px); each seed scales 0.6–1.35×
  hold: 620, // hold at peak before blow-off (ms)
  veil: 70, // white veil peak opacity (%)
  wind: 1800, // blow-off wind strength
  wangle: 75, // wind angle (deg)
  gust: 240, // wind ramp-in (ms)
  blow: 950, // blow-off duration (ms)
}

const clampDpr = () => Math.min(window.devicePixelRatio || 1, 3)
const rand = (a, b) => a + Math.random() * (b - a)

// originRect: { cx, cy, w, h } in viewport (CSS) pixels — the tapped card.
export function createDandelionField(canvas, {
  originRect,
  params = DANDELION_PARAMS,
  onPeak, // () => void — fired at max coverage; navigate the game in here
  onBlow, // () => void — fired when the wind starts; play the whoosh here
  onDone, // () => void — fired when the field is empty
} = {}) {
  const sprite = getDandelionSprite()
  const ctx = canvas.getContext('2d')

  let w = 0
  let h = 0
  function size() {
    w = window.innerWidth
    h = window.innerHeight
    const d = clampDpr()
    canvas.width = Math.round(w * d)
    canvas.height = Math.round(h * d)
    ctx.setTransform(d, 0, 0, d, 0, 0)
  }
  size()

  const particles = []
  function emitSeed() {
    // spawn within the card's rect, drifting outward from its center (the puff)
    const ang = rand(0, Math.PI * 2)
    const radf = Math.sqrt(Math.random())
    const x = originRect.cx + Math.cos(ang) * radf * originRect.w * 0.5
    const y = originRect.cy + Math.sin(ang) * radf * originRect.h * 0.5
    const ox = x - originRect.cx
    const oy = y - originRect.cy
    const om = Math.hypot(ox, oy) || 1
    return {
      x, y,
      vx: (ox / om) * rand(10, 40),
      vy: (oy / om) * rand(10, 40) - rand(8, 30), // slight upward bias
      rot: rand(0, Math.PI * 2),
      vrot: rand(-1, 1),
      size: params.size * rand(0.6, 1.35),
      alpha: 0,
      targetAlpha: rand(0.55, 0.95),
      seed: Math.random() * 1000,
      dead: false,
    }
  }

  // ── timeline ──
  const t0 = performance.now()
  const peakAt = params.emit + params.hold
  const navAt = Math.max(0, peakAt - 140) // navigate at max coverage, just before blow
  let blowStart = null
  let veil = 0
  let navFired = false
  let stopped = false
  let raf = 0
  let lastT = 0

  // emit seeds spread across the emission window
  const total = Math.round(params.count)
  let emitted = 0
  const emitTimer = setInterval(() => {
    const batch = Math.ceil(total / (params.emit / 16))
    for (let i = 0; i < batch && emitted < total; i++, emitted++) {
      particles.push(emitSeed())
    }
    if (emitted >= total) clearInterval(emitTimer)
  }, 16)

  // schedule the breath blow-off
  const blowTimer = setTimeout(() => {
    blowStart = performance.now()
    onBlow?.()
  }, peakAt)

  function frame(now) {
    if (stopped) return
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000)
    lastT = now
    ctx.clearRect(0, 0, w, h)

    const elapsed = now - t0

    // navigate the live game in behind the cover at max coverage
    if (!navFired && elapsed >= navAt) {
      navFired = true
      onPeak?.()
    }

    // ── veil: rises to the whiteout peak, then clears during blow-off ──
    let veilTarget
    if (blowStart) {
      const bt = (now - blowStart) / params.blow
      veilTarget = (params.veil / 100) * Math.max(0, 1 - bt * 1.6)
    } else {
      veilTarget = (params.veil / 100) * Math.min(1, elapsed / Math.max(1, peakAt * 0.85))
    }
    veil += (veilTarget - veil) * Math.min(1, dt * 6)

    // ── wind force during blow-off ──
    let gust = 0
    let windX = 0
    let windY = 0
    if (blowStart) {
      const ramp = Math.min(1, (now - blowStart) / params.gust)
      const a = (params.wangle * Math.PI) / 180
      gust = params.wind * ramp
      windX = Math.cos(a) * gust
      windY = (Math.sin(a) - 1) * gust // -1 → strong updraft component
    }

    let alive = 0
    for (const p of particles) {
      if (p.dead) continue
      p.alpha += (p.targetAlpha - p.alpha) * Math.min(1, dt * 5)

      if (!blowStart) {
        // BLOOM: buoyant drift + swirl, spreading outward to fill the screen
        p.vx += Math.sin(now * 0.0006 + p.seed) * params.swirl * dt
        p.vy += Math.cos(now * 0.0005 + p.seed * 1.3) * params.swirl * 0.6 * dt
        p.vy -= params.lift * dt
        p.vx *= 1 + 0.4 * dt
        p.vy *= 1 + 0.2 * dt
        const cap = params.drift
        p.vx = Math.max(-cap, Math.min(cap, p.vx))
        p.vy = Math.max(-cap, Math.min(cap, p.vy))
      } else {
        // BLOW-OFF: the breath. strong directional wind + turbulence.
        const turb = Math.sin(now * 0.003 + p.seed) * gust * 0.12
        p.vx += (windX + turb) * dt
        p.vy += windY * dt
        p.vrot += p.vx * 0.0008
      }

      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vrot * dt

      const off = p.x < -80 || p.x > w + 80 || p.y < -80 || p.y > h + 80
      if (blowStart && off) {
        p.dead = true
        continue
      }
      alive++

      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      const s = p.size
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s)
      ctx.restore()
    }

    // ── white veil — fills gaps to reach near-full whiteout cheaply ──
    if (veil > 0.001) {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
      g.addColorStop(0, `rgba(255,255,255,${veil})`)
      g.addColorStop(0.7, `rgba(255,255,255,${veil * 0.9})`)
      g.addColorStop(1, `rgba(255,255,255,${veil * 0.5})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    // ── end condition ──
    const blowElapsed = blowStart ? now - blowStart : 0
    const blowDone = blowStart && blowElapsed > params.blow
    if (blowDone && (alive === 0 || blowElapsed > params.blow + 600)) {
      finish()
      return
    }
    raf = requestAnimationFrame(frame)
  }

  function finish() {
    if (stopped) return
    stopped = true
    clearInterval(emitTimer)
    clearTimeout(blowTimer)
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, w, h)
    onDone?.()
  }

  raf = requestAnimationFrame(frame)

  // stop(): hard teardown for an interrupted/unmounted transition.
  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(emitTimer)
      clearTimeout(blowTimer)
      cancelAnimationFrame(raf)
      ctx.clearRect(0, 0, w, h)
    },
  }
}
