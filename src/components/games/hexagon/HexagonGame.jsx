import { useState, useRef, useEffect } from 'react'
import GameIntro     from '../../ui/transitions/GameIntro'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor (game #3)
import HexagonCanvas  from './HexagonCanvas'

// Mirrors the flag in SquareGame.jsx — see comment there. The two games
// share the StrokeSelector component, but each toggles its visibility
// independently. Flip together when restoring the feature.
const STROKE_SELECTOR_ENABLED = false

// ── buildDesertBg ─────────────────────────────────────────────────────────────
// Bakes the entire static background — base gradient, warm sun pools, sage-scrub
// dapples, top-edge depth, and four slanted shafts (two canyon-wall shadows, two
// desert sunbeams) — into a single offscreen canvas at device-pixel resolution.
// Southern-Utah desert palette: warm red-rock and sandstone with sage accents,
// counterpart to the Square game's cool forest-bathing scene. All composition
// happens in canvas-land via globalCompositeOperation; no CSS blend layers.
function buildDesertBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base diagonal wash — sandstone/red-rock, lighter top-left to darker
  // bottom-right (golden sand → terracotta → deep canyon shadow).
  const bg = ctx.createLinearGradient(0, 0, w * 0.6, h)
  bg.addColorStop(0,    '#D99E6A')   // warm light sandstone
  bg.addColorStop(0.30, '#C47A4A')   // sandstone orange
  bg.addColorStop(0.55, '#A85636')   // terracotta red rock
  bg.addColorStop(0.78, '#803D28')   // deep red rock
  bg.addColorStop(1.0,  '#56291A')   // dark canyon shadow
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Screen-blend phase — all subsequent fills brighten what's below
  ctx.globalCompositeOperation = 'screen'

  // Warm desert sun pools — intense golden light
  for (const { cx, cy, rf, a } of [
    { cx: 0.22, cy: 0.28, rf: 0.38, a: 0.13 },
    { cx: 0.72, cy: 0.20, rf: 0.28, a: 0.10 },
    { cx: 0.60, cy: 0.68, rf: 0.34, a: 0.11 },
    { cx: 0.18, cy: 0.72, rf: 0.24, a: 0.09 },
  ]) {
    const px = cx * w, py = cy * h, r = rf * Math.max(w, h)
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, `rgba(238,200,138,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Sage-scrub dapples — muted desert-sage pools, the cool accent against the
  // warm rock (desert sagebrush catching light).
  for (const { cx, cy, rf, color } of [
    { cx: 0.21, cy: 0.26, rf: 0.33, color: 'rgba(150,162,120,0.11)' },
    { cx: 0.71, cy: 0.19, rf: 0.26, color: 'rgba(142,156,116,0.08)' },
    { cx: 0.80, cy: 0.60, rf: 0.29, color: 'rgba(148,160,118,0.10)' },
    { cx: 0.33, cy: 0.72, rf: 0.31, color: 'rgba(138,152,112,0.09)' },
    { cx: 0.54, cy: 0.44, rf: 0.23, color: 'rgba(145,158,116,0.07)' },
  ]) {
    const px = cx * w, py = cy * h, r = rf * Math.max(w, h)
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Top-edge depth — warm red-brown wash on upper 22% (canyon-rim shadow)
  const topShadow = ctx.createLinearGradient(0, 0, 0, h * 0.22)
  topShadow.addColorStop(0,     'rgba(85,45,30,0.15)')
  topShadow.addColorStop(0.636, 'rgba(64,34,22,0.06)')
  topShadow.addColorStop(1,     'rgba(0,0,0,0)')
  ctx.fillStyle = topShadow
  ctx.fillRect(0, 0, w, h * 0.22)

  // Slanted shafts — two dark (canyon-wall shadows), two bright (desert sunbeams)
  paintShaft(ctx, w, h,
    [[0.02, 0], [0.31, 0], [0.44, 1], [0.15, 1]],
    [
      [0,    'rgba(92,46,28,0)'],
      [0.30, 'rgba(92,46,28,0.22)'],
      [0.55, 'rgba(74,36,20,0.28)'],
      [0.78, 'rgba(56,28,16,0.18)'],
      [1.00, 'rgba(36,18,10,0.05)'],
    ])
  paintShaft(ctx, w, h,
    [[0.62, 0], [0.80, 0], [0.91, 1], [0.74, 1]],
    [
      [0,    'rgba(90,44,26,0)'],
      [0.28, 'rgba(90,44,26,0.18)'],
      [0.58, 'rgba(70,34,18,0.24)'],
      [0.80, 'rgba(52,26,14,0.14)'],
      [1.00, 'rgba(32,16,9,0.04)'],
    ])
  paintShaft(ctx, w, h,
    [[0.05, 0], [0.15, 0], [0.36, 1], [0.18, 1]],
    [
      [0,    'rgba(255,226,160,0)'],
      [0.18, 'rgba(255,226,160,0.28)'],
      [0.50, 'rgba(250,212,148,0.24)'],
      [0.80, 'rgba(240,200,135,0.12)'],
      [1.00, 'rgba(255,226,160,0)'],
    ])
  paintShaft(ctx, w, h,
    [[0.60, 0], [0.70, 0], [0.84, 1], [0.70, 1]],
    [
      [0,    'rgba(255,226,160,0)'],
      [0.22, 'rgba(255,226,160,0.22)'],
      [0.55, 'rgba(250,212,148,0.18)'],
      [0.82, 'rgba(240,200,135,0.10)'],
      [1.00, 'rgba(255,226,160,0)'],
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

// 6-edge label sequence, traversed CW from the upper-left vertex of the
// reoriented hexagon (pointy top/bottom, vertical hold sides E/W). Pattern:
// breathe in / breathe out / hold (twice). Angles align text to each side:
// the four in/out diagonals tilt ±π/6 (~±30°), and the two hold sides are
// vertical so their text rotates ±π/2 — right side −π/2, left side +π/2,
// matching the Square game's vertical 'hold' labels.
const LABEL_TEXTS  = ['breathe in', 'breathe out', 'hold', 'breathe in', 'breathe out', 'hold']
const LABEL_ANGLES = [-Math.PI / 6, Math.PI / 6, -Math.PI / 2, -Math.PI / 6, Math.PI / 6, Math.PI / 2]

// ── HexagonGame ───────────────────────────────────────────────────────────────
// Phase manager — owns intro/game phase, stroke selection, session timing, exit.
// All canvas drawing, game geometry, and pointer handling live in HexagonCanvas.
export default function HexagonGame({ onExit, introVariant = 'fadeSettle' }) {

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState('intro')   // 'intro' | 'game'
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]     = useState(null)      // { labelMids, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef = useRef(null)
  const strokeModeRef   = useRef('classic')
  const hexagonCanvasRef = useRef(null)
  const bgCanvasRef     = useRef(null)
  const pacingCanvasRef = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Desert background — baked once per resize ──────────────────────────────
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
      el.getContext('2d').drawImage(buildDesertBg(w, h, dpr), 0, 0)
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
    hexagonCanvasRef.current?.reset()
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    document.documentElement.style.setProperty('--game-saturation', '1')
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    onExit(dur)
  }

  return (
    <div
      className="absolute inset-0 bg-bg-cream overflow-hidden select-none"
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

          <HexagonCanvas
            ref={hexagonCanvasRef}
            strokeModeRef={strokeModeRef}
            pacingCanvasRef={pacingCanvasRef}
            onGameStart={() => { sessionStartRef.current = Date.now() }}
            onResize={setLabelGeo}
            interactive={phase === 'game'}
          />
        </div>

        {/* Pacing-circle layer — sits ABOVE the saturate wrapper so the circle
            (and its grown/glowing state at the heat-gauge floor) stays vivid
            while the rest of the world desaturates. Inside the blur wrapper so
            it still blurs with the scene during the intro. */}
        <canvas
          ref={pacingCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />

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
                    color:      'rgba(92,46,28,1)',   // warm canyon red-brown (desert label)
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

      {/* stroke selector — game phase only.
          Currently disabled via STROKE_SELECTOR_ENABLED (see top of file). */}
      {STROKE_SELECTOR_ENABLED && phase === 'game' && (
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
