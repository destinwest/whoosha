import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import HeartCanvas from './HeartCanvas'
import CompletionScreen from '../square/CompletionScreen'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity/Triangle).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── buildSalmonBg ─────────────────────────────────────────────────────────────
// Bakes the entire static background into a single offscreen canvas at
// device-pixel resolution. Design brief: a soft salmon field, more RED than
// orange (NOT a peachy/orange salmon), radiating from the canvas center
// outward — a radial gradient, not Triangle's vertical linear sky. No
// ridges/scenery — just the gradient, baked once per resize; per-frame cost
// is zero (same "bake once" convention as every other game's background —
// see POLISH-STRATEGY.md).
//
// Stops authored as HSL (hue ~6-12°, which reads as red-leaning coral/salmon
// — orange starts around 25-35°) so the same paletteColor() scaling lever
// Triangle uses is available for future tuning, even though the current
// PALETTE multiplier is a no-op pass-through.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function paletteColor(h, s, l, pal, alpha) {
  const ss = clamp(s * pal.satMul, 0, 100)
  const ll = clamp(l + pal.lightShift, 0, 100)
  return alpha === undefined
    ? `hsl(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%,${alpha})`
}

// Radial stops, center → edge: bright warm coral-red at the center, softening
// and deepening slightly toward the outer edge.
const SALMON_STOPS = [
  { t: 0.00, h: 8,  s: 68.0, l: 72.0 },
  { t: 0.35, h: 9,  s: 58.0, l: 66.0 },
  { t: 0.65, h: 10, s: 48.0, l: 58.0 },
  { t: 1.00, h: 12, s: 40.0, l: 48.0 },
]

const SALMON_PALETTE = { satMul: 1.0, lightShift: 0.0 }

function buildSalmonBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const cx = w / 2
  const cy = h / 2
  const outerR = Math.hypot(w, h) / 2   // reaches the farthest corner
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR)
  for (const stop of SALMON_STOPS) grad.addColorStop(stop.t, paletteColor(stop.h, stop.s, stop.l, SALMON_PALETTE))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  return oc
}

// 2-half label sequence: the path splits at the exact vertical centerline —
// left half (cleft → bottom point, through the left lobe) is "breathe in",
// right half (bottom point → cleft, through the right lobe) is "breathe out".
// Both labels stay upright (0 rad) — the heart's lobes don't have a single
// dominant edge direction the way Triangle's straight sides do.
const LABEL_TEXTS  = ['breathe in', 'breathe out']
const LABEL_ANGLES = [0, 0]

// ── HeartGame ─────────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, and
// the baked salmon-radial background. All canvas drawing, geometry, and
// pointer handling live in HeartCanvas. No audio this pass (matches Triangle).
export default function HeartGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity / Triangle).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]         = useState(null)   // { labelMids, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const heartCanvasRef   = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Salmon-radial background — baked once per resize ─────────────────────────
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
      el.getContext('2d').drawImage(buildSalmonBg(w, h, dpr), 0, 0)
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
    heartCanvasRef.current?.reset()
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
      style={{ touchAction: 'none', background: '#E8836B' }}
    >
      {/* back button */}
      <button
        onClick={handleExit}
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-slate-700/15 text-slate-700 hover:bg-slate-700/25 active:bg-slate-700/30 transition-colors"
        aria-label="Exit game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties.
          Dims (doesn't vanish) once completion phase begins, same treatment as
          Infinity/Triangle's world wrapper. */}
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
          {/* Salmon radial — baked at resize; all texture composited in canvas-land */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <HeartCanvas
            ref={heartCanvasRef}
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
                    color:      'rgba(74,32,44,1)',   // deep warm rose (readable on salmon)
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

      {/* Vignette — a gentle warm darkening at the edges. */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(90,35,40,0.20) 100%)',
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

      {/* completion overlay — time shown first, then the trailing phrase, per
          user-preference-testing variant. */}
      {phase === 'completion' && (
        <CompletionScreen
          durationSeconds={completionSeconds}
          onDismiss={handleCompletionDismiss}
          leadText=""
          trailText="of just breathing"
        />
      )}
    </div>
  )
}
