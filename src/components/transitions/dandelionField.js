// ── dandelionField ───────────────────────────────────────────────────────────
// The transient particle system for the card → game transition. Everything lives
// on ONE full-screen canvas the caller mounts only during the transition and
// tears down after (so the single-overlay perf budget is respected — this layer
// does not persist into gameplay).
//
// Four beats, driven by one rAF loop:
//   bloom   — seeds emit from the tapped card and FLY OUT to fill the whole
//             screen (each seed has a screen-covering destination), thickening
//             into an opaque field of soft fluff
//   peak    — full whiteout: the field + a white veil reach full opacity, fully
//             hiding everything. ONLY THEN is the live game navigated in behind
//             it (onPeak), so the game is never visible until it's revealed
//   blow    — the breath (onBlow → whoosh). A directional wind flings every seed
//             off-screen and the veil clears, so the game is uncovered as the
//             fluff is swept away
//   done    — onDone() when the field is empty; caller unmounts the overlay
//
// DPR-aware (rule 6). The seed sprite is baked once (see dandelionSprite.js).

import { getDandelionSprite } from './dandelionSprite'

// Tuning. Coverage-first: enough seeds + size + veil to fully hide the game at
// peak, then a strong wind that accelerates them off-screen on the breath.
export const DANDELION_PARAMS = {
  count: 1800, // seed count — dense enough that the fluff itself blankets the screen
  emit: 820, // emission stagger window (ms) — seeds appear over this window
  size: 18, // base seed size (px); each seed scales 0.55–1.5×
  swirl: 55, // organic wobble amplitude (px) during the spread
  bloom: 480, // extra time after emit for the fluff to finish filling the screen (ms)
  white: 260, // whiteout ramp — fluff-full → opaque, masking the mount (ms)
  settle: 300, // full-whiteout hold after the game mounts (ms)
  veil: 99, // whiteout peak opacity (%) — high enough that the mount is fully hidden
  wind: 2400, // blow-off wind acceleration
  kick: 520, // immediate velocity kick at blow start (px/s)
  wangle: 62, // wind angle (deg)
  gust: 180, // wind ramp-in (ms)
  blow: 1000, // blow-off duration (ms)
}

const clampDpr = () => Math.min(window.devicePixelRatio || 1, 3)
const rand = (a, b) => a + Math.random() * (b - a)
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

// originRect: { cx, cy, w, h } in viewport (CSS) pixels — the tapped card.
export function createDandelionField(canvas, {
  originRect,
  params = DANDELION_PARAMS,
  onPeak, // () => void — fired once the cover is opaque; navigate the game here
  onBlow, // () => void — fired when the wind starts; play the breath whoosh here
  onDone, // () => void — fired when the field is empty
} = {}) {
  const sprite = getDandelionSprite()
  const ctx = canvas.getContext('2d')

  let w = window.innerWidth
  let h = window.innerHeight
  function size() {
    w = window.innerWidth
    h = window.innerHeight
    const d = clampDpr()
    canvas.width = Math.round(w * d)
    canvas.height = Math.round(h * d)
    ctx.setTransform(d, 0, 0, d, 0, 0)
  }
  size()

  // ── phase timeline (absolute ms from t0) ──
  const bloomFullAt = params.emit + params.bloom // fluff has filled the screen
  const whiteFullAt = bloomFullAt + params.white // veil is fully opaque
  const navAt = whiteFullAt // mount the game — fully hidden behind the whiteout
  const blowAt = whiteFullAt + params.settle // start the breath blow-off

  // ── Screen-covering destinations: a jittered grid that slightly over-scans
  // the viewport so the edges are fully blanketed. Each seed flies from the card
  // to one of these homes by peak time.
  const total = Math.round(params.count)
  const aspect = w / h
  const cols = Math.max(1, Math.round(Math.sqrt(total * aspect)))
  const rows = Math.ceil(total / cols)
  const homes = []
  const OS = 0.12 // over-scan fraction beyond each edge
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hx = (-OS + (1 + 2 * OS) * ((c + 0.5) / cols)) * w + rand(-w / cols, w / cols) * 0.5
      const hy = (-OS + (1 + 2 * OS) * ((r + 0.5) / rows)) * h + rand(-h / rows, h / rows) * 0.5
      homes.push([hx, hy])
    }
  }
  // shuffle so emission order isn't spatially banded
  for (let i = homes.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[homes[i], homes[j]] = [homes[j], homes[i]]
  }

  const particles = []
  for (let i = 0; i < total; i++) {
    // spawn within the card's rect (the puff originates from the card)
    const ang = rand(0, Math.PI * 2)
    const radf = Math.sqrt(Math.random())
    const sx = originRect.cx + Math.cos(ang) * radf * originRect.w * 0.5
    const sy = originRect.cy + Math.sin(ang) * radf * originRect.h * 0.5
    const [hx, hy] = homes[i % homes.length]
    particles.push({
      sx, sy, hx, hy,
      x: sx, y: sy,
      vx: 0, vy: 0,
      emitAt: rand(0, params.emit),
      spinPhase: rand(0, Math.PI * 2),
      vrot: rand(-1.2, 1.2),
      rot: rand(0, Math.PI * 2),
      size: params.size * rand(0.55, 1.5),
      seed: Math.random() * 1000,
      dead: false,
    })
  }

  // ── timeline state ──
  const t0 = performance.now()
  let blowStart = null
  let veil = 0
  let navFired = false
  let stopped = false
  let raf = 0
  let lastT = 0

  const blowTimer = setTimeout(() => {
    blowStart = performance.now()
    onBlow?.()
  }, blowAt)

  function frame(now) {
    if (stopped) return
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000)
    lastT = now
    ctx.clearRect(0, 0, w, h)

    const elapsed = now - t0

    // ── veil, driven DIRECTLY from elapsed time (frame-rate independent, so it
    // is deterministically opaque by the mount and never lags behind a dropped
    // frame). The fluff fills the screen first (no veil), then it whites out to
    // mask the mount, then clears fast on the breath so the fluff is what sweeps
    // away to reveal the game. ──
    const veilPeak = params.veil / 100
    if (blowStart) {
      const bt = (now - blowStart) / params.blow
      veil = veilPeak * Math.max(0, 1 - bt * 3.0) // clears over the first ~33% of the blow
    } else if (elapsed <= bloomFullAt) {
      veil = 0 // fluff visibly filling the screen — no whiteout yet
    } else {
      veil = veilPeak * Math.min(1, (elapsed - bloomFullAt) / params.white)
    }

    // Navigate the live game in ONLY once the whiteout is fully opaque — it
    // mounts hidden, so it can never be seen until the blow-off sweeps the
    // fluff away and reveals it.
    if (!navFired && !blowStart && elapsed >= navAt) {
      navFired = true
      onPeak?.()
    }

    // ── wind during blow-off ──
    let gust = 0
    let windX = 0
    let windY = 0
    if (blowStart) {
      const ramp = Math.min(1, (now - blowStart) / params.gust)
      const a = (params.wangle * Math.PI) / 180
      gust = params.wind * ramp
      windX = Math.cos(a) * gust
      windY = (Math.sin(a) - 1) * gust // -1 → updraft component
    }

    let alive = 0
    for (const p of particles) {
      if (p.dead) continue
      if (elapsed < p.emitAt) {
        // not yet emitted — still sitting on the card; keep it parked there
        p.x = p.sx
        p.y = p.sy
        continue
      }

      if (!blowStart) {
        // BLOOM: fly from card → screen-covering home, reaching it by peak.
        const localT = Math.min(1, (elapsed - p.emitAt) / Math.max(1, bloomFullAt - p.emitAt))
        const e = easeOutCubic(localT)
        const wob = params.swirl * (1 - e) // wobble fades as it settles
        p.x = p.sx + (p.hx - p.sx) * e + Math.sin(now * 0.0017 + p.seed) * wob
        p.y = p.sy + (p.hy - p.sy) * e + Math.cos(now * 0.0015 + p.seed * 1.3) * wob
        p.rot += p.vrot * dt
      } else {
        // BLOW-OFF: the breath. immediate kick + strong wind acceleration so the
        // whole field accelerates off-screen, uncovering the game.
        if (!p.kicked) {
          p.kicked = true
          const a = (params.wangle * Math.PI) / 180
          p.vx = Math.cos(a) * params.kick + rand(-60, 60)
          p.vy = (Math.sin(a) - 1) * params.kick + rand(-60, 60)
        }
        const turb = Math.sin(now * 0.003 + p.seed) * gust * 0.14
        p.vx += (windX + turb) * dt
        p.vy += windY * dt
        p.vrot += p.vx * 0.0006
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vrot * dt
        if (p.x < -90 || p.x > w + 90 || p.y < -90 || p.y > h + 90) {
          p.dead = true
          continue
        }
      }
      alive++

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      const s = p.size
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s)
      ctx.restore()
    }

    // ── white veil — guarantees a clean whiteout / hides any residual gap ──
    if (veil > 0.001) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, veil)})`
      ctx.fillRect(0, 0, w, h)
    }

    // ── end condition ──
    const blowElapsed = blowStart ? now - blowStart : 0
    const blowDone = blowStart && blowElapsed > params.blow
    if (blowDone && (alive === 0 || blowElapsed > params.blow + 700)) {
      finish()
      return
    }
    raf = requestAnimationFrame(frame)
  }

  function finish() {
    if (stopped) return
    stopped = true
    clearTimeout(blowTimer)
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, w, h)
    onDone?.()
  }

  raf = requestAnimationFrame(frame)

  return {
    stop() {
      if (stopped) return
      stopped = true
      clearTimeout(blowTimer)
      cancelAnimationFrame(raf)
      ctx.clearRect(0, 0, w, h)
    },
  }
}
