import { useState, useRef, useEffect } from 'react'
import InfinityCanvas   from './InfinityCanvas'
import CompletionScreen from '../square/CompletionScreen'

// Game canvas opacity once completion phase begins — the world recedes behind
// the completion card without vanishing entirely.
const COMPLETION_CANVAS_OPACITY = 0.25

// Two-phase lazy-8 breath: top lobe = inhale, bottom lobe = exhale.
const LABEL_TEXTS = ['breathe in', 'breathe out']

// ── mulberry32 ────────────────────────────────────────────────────────────────
// Tiny seeded PRNG so the baked star field is identical across re-bakes (resize),
// no flicker of stars jumping to new positions when the canvas re-lays-out.
function mulberry32(seed) {
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

// ── InfinityGame ──────────────────────────────────────────────────────────────
// Phase manager — owns intro/game/completion phase, session timing, exit, and the
// baked night-sky background. All canvas drawing + geometry live in InfinityCanvas.
export default function InfinityGame({ onExit }) {
  const [phase, setPhase]                         = useState('game')  // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [labelGeo, setLabelGeo]                   = useState(null)    // { labelMids, size }

  const sessionStartRef = useRef(null)
  const infinityCanvasRef = useRef(null)
  const bgCanvasRef       = useRef(null)
  const pacingCanvasRef   = useRef(null)

  // ── Night-sky background — baked once per resize ────────────────────────────
  useEffect(() => {
    const el = bgCanvasRef.current
    if (!el) return
    function draw() {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (!w || !h) return
      const dpr = window.devicePixelRatio || 1
      el.width  = w * dpr
      el.height = h * dpr
      el.getContext('2d').drawImage(buildNightSkyBg(w, h, dpr), 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Exit → completion → dismiss ─────────────────────────────────────────────
  function handleExit() {
    if (phase === 'completion') { handleCompletionDismiss(); return }
    document.documentElement.style.setProperty('--game-saturation', '1')
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    setCompletionSeconds(dur)
    setPhase('completion')
  }
  function handleCompletionDismiss() { onExit(completionSeconds) }

  return (
    <div className="absolute inset-0 overflow-hidden select-none" style={{ touchAction: 'none', background: '#070A22' }}>
      {/* Top chrome */}
      <div style={{ opacity: 'var(--intro-ui, 1)' }}>
        <button
          onClick={handleExit}
          className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30 transition-colors"
          aria-label="Exit game"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
      </div>

      {/* The world */}
      <div style={{
        position: 'absolute', inset: 0, background: '#070A22',
        opacity: phase === 'completion' ? COMPLETION_CANVAS_OPACITY : 1,
        transition: phase === 'completion' ? 'opacity 1800ms ease' : undefined,
      }}>
        {/* Night sky — baked; desaturates with the heat gauge */}
        <div style={{
          position: 'absolute', inset: 0,
          filter: 'saturate(var(--game-saturation, 1))',
          willChange: 'filter',
        }}>
          <canvas ref={bgCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>

        {/* Foreground — the breathing figure-8 */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {/* Saturation wrapper — track desaturates in lockstep with the sky */}
          <div style={{
            position: 'absolute', inset: 0,
            filter: 'saturate(var(--game-saturation, 1))',
            willChange: 'filter',
          }}>
            <InfinityCanvas
              ref={infinityCanvasRef}
              pacingCanvasRef={pacingCanvasRef}
              onGameStart={() => { sessionStartRef.current = Date.now() }}
              onResize={setLabelGeo}
              interactive={phase === 'game'}
            />
          </div>

          {/* Pacing-circle layer — above the saturate wrapper so it stays vivid */}
          <canvas
            ref={pacingCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />

          {/* Labels — DOM text at each lobe's center (static for now) */}
          {labelGeo && (() => {
            const fs = Math.max(13, labelGeo.size * 0.045)
            return (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {LABEL_TEXTS.map((text, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: labelGeo.labelMids[i].x,
                      top:  labelGeo.labelMids[i].y,
                      transform: 'translate(-50%, -50%)',
                      fontFamily: "'Nunito', sans-serif",
                      fontWeight: 700,
                      fontSize: `${fs}px`,
                      color: 'rgba(232,227,248,0.82)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {text}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Vignette — the one allowed overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%)',
      }} />

      {/* Completion overlay */}
      {phase === 'completion' && (
        <CompletionScreen durationSeconds={completionSeconds} onDismiss={handleCompletionDismiss} />
      )}
    </div>
  )
}
