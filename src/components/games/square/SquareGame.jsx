import { useState, useRef, useEffect } from 'react'
import GameIntro     from '../../ui/transitions/GameIntro'
import StrokeSelector from './StrokeSelector'
import SquareCanvas   from './SquareCanvas'

// ── buildMeadowBg ─────────────────────────────────────────────────────────────
// Bakes the meadow background to an offscreen canvas once per resize.
// Zero per-frame cost — drawn to the bg canvas via ResizeObserver.
function buildMeadowBg(w, h) {
  const oc = document.createElement('canvas')
  oc.width  = w
  oc.height = h
  const ctx = oc.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, w * 0.6, h)
  bg.addColorStop(0,    '#B0CECA')
  bg.addColorStop(0.30, '#9BBFBB')
  bg.addColorStop(0.55, '#8AB5B1')
  bg.addColorStop(0.78, '#7AA5A0')
  bg.addColorStop(1.0,  '#7A9E99')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Dappled light pools — large radial gradients at screen blend read as
  // soft canopy light; pixel-scale noise at this size reads as static.
  ctx.globalCompositeOperation = 'screen'
  const pools = [
    { x: 0.22 * w, y: 0.28 * h, r: 0.38 * Math.max(w, h), a: 0.12 },
    { x: 0.72 * w, y: 0.20 * h, r: 0.28 * Math.max(w, h), a: 0.09 },
    { x: 0.60 * w, y: 0.68 * h, r: 0.34 * Math.max(w, h), a: 0.10 },
    { x: 0.18 * w, y: 0.72 * h, r: 0.24 * Math.max(w, h), a: 0.08 },
  ]
  for (const { x, y, r, a } of pools) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(218,195,128,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  ctx.globalCompositeOperation = 'source-over'
  return oc
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
      el.width  = w
      el.height = h
      el.getContext('2d').drawImage(buildMeadowBg(w, h), 0, 0)
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

      {/* Layer 1: Meadow floor — baked Canvas 2D texture; stays stationary during intro */}
      <canvas
        ref={bgCanvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties */}
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'blur(var(--intro-blur, 0px))',
        transform: 'translateY(var(--intro-y, 0px)) scale(var(--intro-scale, 1))',
        transformOrigin: 'center center',
        willChange: 'transform, filter',
      }}>
        {/* Saturation wrapper — overlays and canvas share one filter so they desaturate together.
            filter: saturate creates an isolated compositing group; putting both here ensures
            the gauge affects all game elements uniformly. Background canvas stays outside. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          filter: 'saturate(var(--game-saturation, 1))',
          willChange: 'filter',
        }}>
          {/* Ambient lighting overlays — sit below the canvas, show through its transparent bg */}
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen', background: `
            radial-gradient(ellipse 38% 28% at 21% 26%, rgba(105,140,45,0.12) 0%, transparent 100%),
            radial-gradient(ellipse 30% 22% at 71% 19%, rgba( 98,130,40,0.09) 0%, transparent 100%),
            radial-gradient(ellipse 32% 26% at 80% 60%, rgba(102,136,43,0.11) 0%, transparent 100%),
            radial-gradient(ellipse 35% 28% at 33% 72%, rgba( 96,128,38,0.10) 0%, transparent 100%),
            radial-gradient(ellipse 26% 20% at 54% 44%, rgba( 90,122,35,0.08) 0%, transparent 100%)
          ` }} />
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen',
            background: 'linear-gradient(180deg, rgba(48,82,65,0.14) 0%, rgba(32,58,46,0.05) 14%, transparent 22%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen',
            clipPath: 'polygon(2% 0%, 31% 0%, 44% 100%, 15% 100%)',
            background: 'linear-gradient(148deg, rgba(88,74,24,0) 0%, rgba(88,74,24,0.22) 30%, rgba(72,60,18,0.28) 55%, rgba(55,46,14,0.18) 78%, rgba(35,28,8,0.05) 100%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen',
            clipPath: 'polygon(62% 0%, 80% 0%, 91% 100%, 74% 100%)',
            background: 'linear-gradient(148deg, rgba(85,72,22,0) 0%, rgba(85,72,22,0.18) 28%, rgba(68,57,16,0.24) 58%, rgba(50,42,12,0.14) 80%, rgba(30,25,7,0.04) 100%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen',
            clipPath: 'polygon(5% 0%, 15% 0%, 36% 100%, 18% 100%)',
            background: 'linear-gradient(148deg, transparent 0%, rgba(255,240,175,0.28) 18%, rgba(248,228,158,0.24) 50%, rgba(235,215,140,0.12) 80%, transparent 100%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen',
            clipPath: 'polygon(60% 0%, 70% 0%, 84% 100%, 70% 100%)',
            background: 'linear-gradient(148deg, transparent 0%, rgba(255,240,175,0.22) 22%, rgba(248,228,158,0.18) 55%, rgba(235,215,140,0.10) 82%, transparent 100%)',
          }} />

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
