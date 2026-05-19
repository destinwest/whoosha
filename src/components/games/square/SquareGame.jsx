import { useState, useRef, useEffect } from 'react'
import GameIntro     from '../../ui/transitions/GameIntro'
import StrokeSelector from './StrokeSelector'
import SquareCanvas   from './SquareCanvas'

// ── buildMeadowBg ─────────────────────────────────────────────────────────────
// Bakes the entire static background — base gradient, sun pools, green canopy
// dapples, top-edge depth, and four slanted shafts — into a single offscreen
// canvas at device-pixel resolution. All composition happens in canvas-land via
// globalCompositeOperation; no CSS blend layers needed at runtime.
function buildMeadowBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base diagonal sage wash
  const bg = ctx.createLinearGradient(0, 0, w * 0.6, h)
  bg.addColorStop(0,    '#B0CECA')
  bg.addColorStop(0.30, '#9BBFBB')
  bg.addColorStop(0.55, '#8AB5B1')
  bg.addColorStop(0.78, '#7AA5A0')
  bg.addColorStop(1.0,  '#7A9E99')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Screen-blend phase — all subsequent fills brighten what's below
  ctx.globalCompositeOperation = 'screen'

  // Amber sun pools — soft warm canopy light
  for (const { cx, cy, rf, a } of [
    { cx: 0.22, cy: 0.28, rf: 0.38, a: 0.12 },
    { cx: 0.72, cy: 0.20, rf: 0.28, a: 0.09 },
    { cx: 0.60, cy: 0.68, rf: 0.34, a: 0.10 },
    { cx: 0.18, cy: 0.72, rf: 0.24, a: 0.08 },
  ]) {
    const px = cx * w, py = cy * h, r = rf * Math.max(w, h)
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, `rgba(218,195,128,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Green canopy dapples — cooler tinted pools, migrated from former CSS overlay
  for (const { cx, cy, rf, color } of [
    { cx: 0.21, cy: 0.26, rf: 0.33, color: 'rgba(105,140,45,0.12)' },
    { cx: 0.71, cy: 0.19, rf: 0.26, color: 'rgba( 98,130,40,0.09)' },
    { cx: 0.80, cy: 0.60, rf: 0.29, color: 'rgba(102,136,43,0.11)' },
    { cx: 0.33, cy: 0.72, rf: 0.31, color: 'rgba( 96,128,38,0.10)' },
    { cx: 0.54, cy: 0.44, rf: 0.23, color: 'rgba( 90,122,35,0.08)' },
  ]) {
    const px = cx * w, py = cy * h, r = rf * Math.max(w, h)
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Top-edge depth — subtle dark wash on upper 22% (canopy shadow)
  const topShadow = ctx.createLinearGradient(0, 0, 0, h * 0.22)
  topShadow.addColorStop(0,     'rgba(48,82,65,0.14)')
  topShadow.addColorStop(0.636, 'rgba(32,58,46,0.05)')
  topShadow.addColorStop(1,     'rgba(0,0,0,0)')
  ctx.fillStyle = topShadow
  ctx.fillRect(0, 0, w, h * 0.22)

  // Slanted shafts — two dark (tree-trunk shadows), two bright (sunbeams)
  paintShaft(ctx, w, h,
    [[0.02, 0], [0.31, 0], [0.44, 1], [0.15, 1]],
    [
      [0,    'rgba(88,74,24,0)'],
      [0.30, 'rgba(88,74,24,0.22)'],
      [0.55, 'rgba(72,60,18,0.28)'],
      [0.78, 'rgba(55,46,14,0.18)'],
      [1.00, 'rgba(35,28,8,0.05)'],
    ])
  paintShaft(ctx, w, h,
    [[0.62, 0], [0.80, 0], [0.91, 1], [0.74, 1]],
    [
      [0,    'rgba(85,72,22,0)'],
      [0.28, 'rgba(85,72,22,0.18)'],
      [0.58, 'rgba(68,57,16,0.24)'],
      [0.80, 'rgba(50,42,12,0.14)'],
      [1.00, 'rgba(30,25,7,0.04)'],
    ])
  paintShaft(ctx, w, h,
    [[0.05, 0], [0.15, 0], [0.36, 1], [0.18, 1]],
    [
      [0,    'rgba(255,240,175,0)'],
      [0.18, 'rgba(255,240,175,0.28)'],
      [0.50, 'rgba(248,228,158,0.24)'],
      [0.80, 'rgba(235,215,140,0.12)'],
      [1.00, 'rgba(255,240,175,0)'],
    ])
  paintShaft(ctx, w, h,
    [[0.60, 0], [0.70, 0], [0.84, 1], [0.70, 1]],
    [
      [0,    'rgba(255,240,175,0)'],
      [0.22, 'rgba(255,240,175,0.22)'],
      [0.55, 'rgba(248,228,158,0.18)'],
      [0.82, 'rgba(235,215,140,0.10)'],
      [1.00, 'rgba(255,240,175,0)'],
    ])

  ctx.globalCompositeOperation = 'source-over'
  return oc
}

// ── paintShaft ────────────────────────────────────────────────────────────────
// Fills a 4-point polygon (CSS-style fractional coords) with a gradient running
// along the polygon's diagonal — used for sunbeams and tree-shadow shafts.
function paintShaft(ctx, w, h, polygon, stops) {
  const pts = polygon.map(([fx, fy]) => [fx * w, fy * h])
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.clip()

  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)

  const grad = ctx.createLinearGradient(minX, minY, maxX, maxY)
  for (const [offset, color] of stops) grad.addColorStop(offset, color)
  ctx.fillStyle = grad
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)
  ctx.restore()
}

const LABEL_TEXTS  = ['breathe in', 'hold', 'breathe out', 'hold']
const LABEL_ANGLES = [0, -Math.PI / 2, 0, Math.PI / 2]

// ── SquareGame ────────────────────────────────────────────────────────────────
// Phase manager — owns intro/game phase, stroke selection, session timing, exit.
// All canvas drawing, game geometry, and pointer handling live in SquareCanvas.
export default function SquareGame({ onExit, introVariant = 'fadeSettle' }) {

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState('intro')   // 'intro' | 'game'
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]     = useState(null)      // { labelMids, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef = useRef(null)
  const strokeModeRef   = useRef('classic')
  const squareCanvasRef = useRef(null)
  const bgCanvasRef     = useRef(null)

  // ── Meadow background — baked once per resize ──────────────────────────────
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
      el.getContext('2d').drawImage(buildMeadowBg(w, h, dpr), 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Stroke selection ────────────────────────────────────────────────────────
  function handleStrokeSelect(newStroke) {
    if (newStroke === strokeModeRef.current) return
    strokeModeRef.current = newStroke
    setActiveStroke(newStroke)
    squareCanvasRef.current?.reset()
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    document.documentElement.style.setProperty('--game-saturation', '1')
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    onExit(dur)
  }

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      {/* back button */}
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

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties */}
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'blur(var(--intro-blur, 0px))',
        transform: 'translateY(var(--intro-y, 0px)) scale(var(--intro-scale, 1))',
        transformOrigin: 'center center',
        willChange: 'transform, filter',
      }}>
        {/* Saturation wrapper — bg canvas and game canvas share one filter so
            the heat gauge desaturates the entire world in lockstep. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          filter: 'saturate(var(--game-saturation, 1))',
          willChange: 'filter',
        }}>
          {/* Meadow floor — baked at resize; all texture/lighting composited in canvas-land */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <SquareCanvas
            ref={squareCanvasRef}
            strokeModeRef={strokeModeRef}
            onGameStart={() => { sessionStartRef.current = Date.now() }}
            onResize={setLabelGeo}
            interactive={phase === 'game'}
          />
        </div>

        {/* label overlay — DOM text, positioned from canvas geometry */}
        {labelGeo && (() => {
          const fs = Math.max(13, labelGeo.sq * 0.048)
          return (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {LABEL_TEXTS.map((text, i) => (
                <div
                  key={i}
                  style={{
                    position:   'absolute',
                    left:       labelGeo.labelMids[i].x,
                    top:        labelGeo.labelMids[i].y,
                    transform:  `translate(-50%, -50%) rotate(${LABEL_ANGLES[i]}rad) scale(var(--label-${i}-scale, 1))`,
                    opacity:    `var(--label-${i}-alpha, 0.75)`,
                    fontFamily: "'Nunito', sans-serif",
                    fontWeight: 700,
                    fontSize:   `${fs}px`,
                    color:      'rgba(44,74,62,1)',
                    whiteSpace: 'nowrap',
                    willChange: 'transform, opacity',
                  }}
                >
                  {text}
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Vignette — sits above all canvas and overlay layers */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.38) 100%)',
        pointerEvents: 'none',
        zIndex: 15,
      }} />

      {/* stroke selector — game phase only */}
      {phase === 'game' && (
        <StrokeSelector
          activeStroke={activeStroke}
          onSelect={handleStrokeSelect}
        />
      )}

      {/* intro overlay — intro phase only */}
      {phase === 'intro' && (
        <GameIntro
          variant={introVariant}
          onComplete={() => setPhase('game')}
        />
      )}
    </div>
  )
}
