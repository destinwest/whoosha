import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import RainbowCanvas from './RainbowCanvas'
import CompletionScreen from '../square/CompletionScreen'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── First-light background ────────────────────────────────────────────────────
// A creamy pastel-yellow morning sky — "the first light of the morning" per the
// user's spec — kept gentle and low-saturation so the rainbow bands carry the
// color. A soft warm glow sits high where the sun would be rising.
const SKY_STOPS = [
  [0.00, '#FEFAE6'],   // palest cream (top)
  [0.45, '#FBF0CC'],   // warm cream
  [1.00, '#F6E4AE'],   // soft buttery yellow (bottom)
]
const BG_SOLID = '#FBF0CC'   // flat fallback behind the canvas (mid sky tone)

// ── buildFirstLightBg ─────────────────────────────────────────────────────────
// Baked once per resize so per-frame cost is zero — same baked-bitmap pattern
// as the other games. Gradient + one screen-blended sun glow, all composited
// in canvas-land (no CSS blend layers).
function buildFirstLightBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const [stop, color] of SKY_STOPS) sky.addColorStop(stop, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // Rising-sun glow — high center, very soft.
  ctx.globalCompositeOperation = 'screen'
  const sunX = w * 0.5, sunY = h * 0.10
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.5)
  sun.addColorStop(0,   'rgba(255,244,214,0.55)')
  sun.addColorStop(0.5, 'rgba(255,238,190,0.16)')
  sun.addColorStop(1,   'rgba(0,0,0,0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, w, h)

  return oc
}

// ── RainbowGame ───────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, and
// the baked first-light background. All canvas drawing, arc geometry, the climb
// schedule, and pointer handling live in RainbowCanvas. Breathing instructions
// are canvas text curved along the active arc (drawn by RainbowCanvas — a DOM
// label can't follow the curve), so there is no label overlay here. No audio
// this pass — no MuteButton.
export default function RainbowGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as the other games).
  const [phase, setPhase] = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef   = useRef(null)
  const strokeModeRef     = useRef('classic')
  const rainbowCanvasRef  = useRef(null)
  const bgCanvasRef       = useRef(null)
  const pacingCanvasRef   = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── First-light background — baked once per resize ─────────────────────────
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
      el.getContext('2d').drawImage(buildFirstLightBg(w, h, dpr), 0, 0)
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
    rainbowCanvasRef.current?.reset()
  }

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
    <div
      className="absolute inset-0 overflow-hidden select-none"
      style={{ touchAction: 'none', background: BG_SOLID }}
    >
      {/* back button */}
      <button
        onClick={handleExit}
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-amber-900/10 text-amber-900/70 hover:bg-amber-900/20 active:bg-amber-900/25 transition-colors"
        aria-label="Exit game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

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
          {/* First-light sky — baked at resize */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <RainbowCanvas
            ref={rainbowCanvasRef}
            strokeModeRef={strokeModeRef}
            pacingCanvasRef={pacingCanvasRef}
            onGameStart={() => { sessionStartRef.current = Date.now() }}
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
      </div>

      {/* Vignette — a gentle warm darkening at the edges (light, so the pale
          morning sky stays luminous). */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(150,118,58,0.14) 100%)',
        pointerEvents: 'none',
        zIndex: 15,
      }} />

      {/* stroke selector — game phase only. Currently disabled. */}
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
          message="how did that feel?"
        />
      )}
    </div>
  )
}
