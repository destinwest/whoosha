import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor (game #3)
import HexagonCanvas  from './HexagonCanvas'
import CompletionScreen from '../square/CompletionScreen'
import MuteButton     from '../../ui/MuteButton'
import { useHexBreath } from '../../../hooks/useHexBreath'

// Mirrors the flag in SquareGame.jsx — see comment there. The two games
// share the StrokeSelector component, but each toggles its visibility
// independently. Flip together when restoring the feature.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// Audio fade-out duration when the game ends (seconds) — matches Square's
// COMPLETION_AUDIO_FADE_S so the breath tone settles at the same pace.
const COMPLETION_AUDIO_FADE_S = 2.0

// ── buildWaveBg ───────────────────────────────────────────────────────────────
// Bakes the entire static background into a single offscreen canvas at
// device-pixel resolution. Inspired by "The Wave" sandstone formation in
// southern Utah: a warm red-rock base overlaid with soft, undulating strata
// bands (the signature sandstone layering) and a single low raking-sun glow.
// Deliberately subtle so the pacing circle, track, and labels stay the focus.
// All composition happens in canvas-land via globalCompositeOperation — no CSS
// blend layers and no runtime SVG filters. The tactile stone grain is a
// separately-baked static texture (see HexagonCanvas), never a live filter.
// Baked once per resize; per-frame cost is zero.
function buildWaveBg(w, h, dpr) {
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

  // Sandstone strata — soft undulating bands, the Wave's signature layering.
  paintStrata(ctx, w, h)

  // Raking sun — a single low warm glow from the upper-left (screen-blended),
  // giving one directional light source like the prototype's 22° sun.
  ctx.globalCompositeOperation = 'screen'
  const sunX = w * 0.24, sunY = h * 0.20
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.55)
  sun.addColorStop(0,   'rgba(238,200,138,0.14)')
  sun.addColorStop(0.5, 'rgba(230,185,120,0.05)')
  sun.addColorStop(1,   'rgba(0,0,0,0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, w, h)

  // Top-edge depth — warm red-brown wash on upper 22% (canyon-rim shadow)
  ctx.globalCompositeOperation = 'source-over'
  const topShadow = ctx.createLinearGradient(0, 0, 0, h * 0.22)
  topShadow.addColorStop(0,     'rgba(85,45,30,0.15)')
  topShadow.addColorStop(0.636, 'rgba(64,34,22,0.06)')
  topShadow.addColorStop(1,     'rgba(0,0,0,0)')
  ctx.fillStyle = topShadow
  ctx.fillRect(0, 0, w, h * 0.22)

  return oc
}

// ── paintStrata ───────────────────────────────────────────────────────────────
// Soft, wide, undulating sandstone bands drawn with `multiply` so they read as
// tonal strata bleeding into the base — no hard edges. Each band is a gently
// waving horizontal ribbon filled with a vertical gradient that fades to
// transparent at both edges. Adapted from the "The Wave" prototype, dialled
// down for a calm backdrop. Band geometry is fraction-of-height so it scales
// with the canvas; two sine harmonics give the lazy undulation.
const STRATA_STEPS = 40
const STRATA_BANDS = [
  { tone: [128,  61, 40],  opacity: 0.16, width: 0.14 },  // deep red rock
  { tone: [217, 158, 106], opacity: 0.12, width: 0.20 },  // light sandstone
  { tone: [128,  61, 40],  opacity: 0.13, width: 0.12 },
  { tone: [217, 158, 106], opacity: 0.11, width: 0.18 },
  { tone: [168,  86, 54],  opacity: 0.14, width: 0.13 },  // terracotta
  { tone: [217, 158, 106], opacity: 0.10, width: 0.19 },
]

function paintStrata(ctx, w, h) {
  const N = STRATA_BANDS.length
  // Gently flowing centerline y for band i (0..N-1), spread across the canvas.
  const bandY = (x, i) => {
    const base = ((i + 1) / (N + 1)) * (h * 1.14) - h * 0.07
    const xn   = x / w
    const ph   = (i + 1) * 1.1
    const w1   = Math.sin(xn * Math.PI * 1.4 + ph)       * h * 0.05
    const w2   = Math.sin(xn * Math.PI * 2.8 + ph * 1.6) * h * 0.02
    return base + w1 + w2
  }

  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  STRATA_BANDS.forEach((band, bi) => {
    const [r, g, b] = band.tone
    const halfW = (band.width * h) / 2

    // Wavy top and bottom edges of the band.
    const top = [], bot = []
    for (let i = 0; i <= STRATA_STEPS; i++) {
      const x  = (i / STRATA_STEPS) * w
      const cy = bandY(x, bi)
      top.push({ x, y: cy - halfW })
      bot.push({ x, y: cy + halfW })
    }

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(-4, top[0].y)
    for (let i = 1; i <= STRATA_STEPS; i++) {
      const p = top[i - 1], q = top[i]
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
    }
    ctx.lineTo(w + 4, top[STRATA_STEPS].y)
    ctx.lineTo(w + 4, bot[STRATA_STEPS].y)
    for (let i = STRATA_STEPS; i >= 1; i--) {
      const p = bot[i], q = bot[i - 1]
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
    }
    ctx.lineTo(-4, bot[0].y)
    ctx.closePath()
    ctx.clip()

    // Vertical gradient inside the clip — fades at both band edges so there is
    // never a hard horizontal line.
    const midY = (bandY(0, bi) + bandY(w, bi)) / 2
    const grd  = ctx.createLinearGradient(0, midY - halfW, 0, midY + halfW)
    grd.addColorStop(0,    `rgba(${r},${g},${b},0)`)
    grd.addColorStop(0.22, `rgba(${r},${g},${b},${band.opacity * 0.7})`)
    grd.addColorStop(0.50, `rgba(${r},${g},${b},${band.opacity})`)
    grd.addColorStop(0.78, `rgba(${r},${g},${b},${band.opacity * 0.7})`)
    grd.addColorStop(1,    `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  })
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
export default function HexagonGame({ onExit }) {

  // ── Phase ──────────────────────────────────────────────────────────────────
  // Mount straight into play — no in-game intro. The card→game launch is owned
  // by the FadeLaunch cross-dissolve (same as Square); a direct URL load drops
  // the player into the ready world immediately.
  const [phase, setPhase]           = useState('game')    // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]     = useState(null)      // { labelMids, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef = useRef(null)
  const strokeModeRef   = useRef('classic')
  const hexagonCanvasRef = useRef(null)
  const bgCanvasRef     = useRef(null)
  const pacingCanvasRef = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Breath audio (audition) ─────────────────────────────────────────────────
  // Minimal breath-only audio path for synthHexBreath. Stable callbacks so the
  // canvas frame loop (captured once at mount) always reaches the live graph.
  const breathRef   = useHexBreath()
  const emitBreath  = useRef((fraction) => breathRef.current.update(fraction)).current
  const unlockAudio = useRef(() => breathRef.current.unlock()).current

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
      el.getContext('2d').drawImage(buildWaveBg(w, h, dpr), 0, 0)
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

  // ── Exit → completion → dismiss ─────────────────────────────────────────────
  function handleExit() {
    if (phase === 'completion') { handleCompletionDismiss(); return }
    document.documentElement.style.setProperty('--game-saturation', '1')
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    setCompletionSeconds(dur)
    breathRef.current?.fadeOut(COMPLETION_AUDIO_FADE_S)
    setPhase('completion')
  }
  function handleCompletionDismiss() { onExit(completionSeconds) }

  return (
    <div
      className="absolute inset-0 bg-bg-cream overflow-hidden select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={unlockAudio}   // resume the AudioContext on the first gesture (iOS)
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

      {/* mute toggle — top-right, mirrors exit-button treatment (same as Square) */}
      <MuteButton className="absolute top-4 right-4 z-20" />

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties.
          Dims (doesn't vanish) once completion phase begins, same treatment as
          Infinity's world wrapper. */}
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'blur(var(--intro-blur, 0px))',
        transform: 'translateY(var(--intro-y, 0px)) scale(var(--intro-scale, 1))',
        transformOrigin: 'center center',
        willChange: 'transform, filter',
        opacity: phase === 'completion' ? COMPLETION_CANVAS_OPACITY : 1,
        transition: phase === 'completion' ? 'opacity 1800ms ease' : undefined,
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
            onBreath={emitBreath}
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

      {/* completion overlay — no time shown, per user-preference-testing variant. */}
      {phase === 'completion' && (
        <CompletionScreen
          durationSeconds={completionSeconds}
          onDismiss={handleCompletionDismiss}
          showTime={false}
          message="good job breathing"
        />
      )}
    </div>
  )
}
