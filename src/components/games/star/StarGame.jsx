import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import StarCanvas from './StarCanvas'
import CompletionScreen from '../square/CompletionScreen'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── Morning's-first-light background ─────────────────────────────────────────
// Soft sunrise gradient after the user's reference photo: light white-yellow at
// the top, through a soft peach/pink glow and dusty lavender, to light blue at
// the bottom. Softened toward the reference's low saturation while staying in
// the same hue family as the paint palette (StarCanvas LAP_COLORS).
const SKY_STOPS = [
  [0.00, '#FCF6DB'],   // light white-yellow (top)
  [0.30, '#FBDAD6'],   // soft peach / pink glow
  [0.55, '#ECD5E4'],   // pink-lavender
  [0.78, '#CFD2EE'],   // lavender-blue
  [1.00, '#A7C2F7'],   // light blue (bottom)
]
const BG_SOLID = '#ECD5E4'   // flat fallback behind the canvas (mid sky tone)

// ── buildMorningBg ──────────────────────────────────────────────────────────
// A single baked vertical gradient, baked once per resize so per-frame cost is
// zero — same baked-bitmap pattern as the other games.
function buildMorningBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const [stop, color] of SKY_STOPS) sky.addColorStop(stop, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  return oc
}

// 10-segment label sequence, traversed clockwise from the valley before the top
// tip. Segments strictly alternate: even sides ascend valley→tip (breathe in),
// odd sides descend tip→valley (breathe out). Rotation for each label comes from
// the geometry (labelAngles), so no hard-coded angle array is needed.
const LABEL_TEXT = (i) => (i % 2 === 0 ? 'breathe in' : 'breathe out')

// ── StarGame ──────────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, and
// the baked (placeholder) morning background. All canvas drawing, geometry, and
// pointer handling live in StarCanvas. No audio this pass.
export default function StarGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity /
  // Triangle).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]         = useState(null)   // { labelMids, labelAngles, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const starCanvasRef    = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Morning background — baked once per resize ──────────────────────────────
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
      el.getContext('2d').drawImage(buildMorningBg(w, h, dpr), 0, 0)
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
    starCanvasRef.current?.reset()
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
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-slate-600/15 text-slate-600 hover:bg-slate-600/25 active:bg-slate-600/30 transition-colors"
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
          {/* Morning background — baked at resize (placeholder gradient for now) */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <StarCanvas
            ref={starCanvasRef}
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

        {/* label overlay — DOM text, positioned + rotated from canvas geometry.
            10 labels alternating breathe in / breathe out around the star. */}
        {labelGeo && (() => {
          const fs = Math.max(11, labelGeo.sq * 0.040)
          return (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {labelGeo.labelMids.map((mid, i) => (
                <div
                  key={i}
                  style={{
                    position:   'absolute',
                    left:       mid.x,
                    top:        mid.y,
                    transform:  `translate(-50%, -50%) rotate(${labelGeo.labelAngles[i]}rad) scale(var(--label-${i}-scale, 1))`,
                    opacity:    `var(--label-${i}-alpha, 0.7)`,
                    fontFamily: "'Nunito', sans-serif",
                    fontWeight: 700,
                    fontSize:   `${fs}px`,
                    color:      'rgba(94,90,134,1)',   // muted lavender-slate — legible on yellow track + pastel sky
                    whiteSpace: 'nowrap',
                    willChange: 'transform, opacity',
                  }}
                >
                  {LABEL_TEXT(i)}
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Vignette — a gentle cool lavender darkening at the edges (light, so the
          pale morning sky doesn't turn muddy). */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(120,116,168,0.16) 100%)',
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
