import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import HeartCanvas from './HeartCanvas'
import CompletionScreen from '../square/CompletionScreen'
import { buildHeartFieldBg } from './heartField'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity/Triangle).
const COMPLETION_CANVAS_OPACITY = 0.25

// 2-half label sequence: the path splits at the exact vertical centerline —
// left half (cleft → bottom point, through the left lobe) is "breathe in",
// right half (bottom point → cleft, through the right lobe) is "breathe out".
// Each label sits on its side of the heart, halfway between the top of the arc
// and the bottom V, and is flowed along a path cut from the track centerline
// (labelGeo.labelPaths) so the text arcs to match the curve.
const LABEL_TEXTS = ['breathe in', 'breathe out']

// ── HeartGame ─────────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, and
// the baked salmon-radial background. All canvas drawing, geometry, and
// pointer handling live in HeartCanvas. No audio this pass (matches Triangle).
export default function HeartGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity / Triangle).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]         = useState(null)   // { labelPaths, sq, w, h }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const heartCanvasRef   = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Heart-field background — baked once per resize ───────────────────────────
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
      el.getContext('2d').drawImage(buildHeartFieldBg(w, h, dpr), 0, 0)
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

        {/* label overlay — SVG text flowed along a path cut from the track
            centerline, so each label arcs to match the heart's curve. The paths
            (and the viewBox size) come from canvas geometry; the per-label alpha
            and scale ride the --label-i-* CSS vars written per frame.

            ONE <svg> PER LABEL, and the scale rides the <svg> ELEMENT (not the
            inner <text>). An SVG root gets its own compositing layer under
            will-change, so it's rasterized ONCE and the growth scales that
            texture on the GPU. Scaling the inner <text> instead made WebKit
            re-rasterize the glyphs every frame — each fractional scale re-hinted
            and re-snapped them to the pixel grid, which is the residual shimmer.
            Trade-off: at the 1.5× peak the cached texture is upsampled, so the
            label softens slightly at its largest; at rest (its usual state) it's
            crisp. Origin is the label's anchor, as a % of the box (preserve-
            AspectRatio="none" maps the viewBox linearly onto it). */}
        {labelGeo && (() => {
          const fs = Math.max(13, labelGeo.sq * 0.048)
          const { w, h } = labelGeo
          return LABEL_TEXTS.map((text, i) => {
            const a  = labelGeo.labelAnchors?.[i]
            const ox = a ? `${((a.x / w) * 100).toFixed(3)}%` : '50%'
            const oy = a ? `${((a.y / h) * 100).toFixed(3)}%` : '50%'
            return (
              <svg
                key={i}
                viewBox={`0 0 ${w} ${h}`}
                preserveAspectRatio="none"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  pointerEvents: 'none', overflow: 'visible',
                  opacity:         `var(--label-${i}-alpha, 0.75)`,
                  transform:       `translateZ(0) scale(var(--label-${i}-scale, 1))`,
                  transformOrigin: `${ox} ${oy}`,
                  willChange:      'transform, opacity',
                }}
              >
                <defs>
                  <path id={`heart-label-path-${i}`} d={labelGeo.labelPaths[i]} fill="none" />
                </defs>
                <text
                  fill="rgba(74,32,44,1)"          /* deep warm rose (readable on salmon) */
                  fontFamily="'Nunito', sans-serif"
                  fontWeight="700"
                  fontSize={fs}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  <textPath href={`#heart-label-path-${i}`} startOffset="50%">
                    {text}
                  </textPath>
                </text>
              </svg>
            )
          })
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
