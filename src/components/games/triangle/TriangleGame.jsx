import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import TriangleCanvas from './TriangleCanvas'
import CompletionScreen from '../square/CompletionScreen'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── buildAlpineBg ──────────────────────────────────────────────────────────────
// Bakes the entire static background into a single offscreen canvas at
// device-pixel resolution. A smooth, hazy blue sky — no wisp/streak shapes at
// all, just soft atmospheric variation, matching a reference photo pixel-
// sampled directly (see SKY_STOPS below). Built from two layers: an 11-stop
// vertical gradient carrying the photo's light→deep→light banding, then a
// scattering of large, soft, overlapping round blobs (two scales: broad "mass"
// blobs for the big soft shape, smaller "detail" blobs for finer variation) to
// fake the photo's gentle local luminance drift. This replaces the earlier
// wispy-cirrus/hero-sweep technique entirely — the reference has no directional
// shapes to draw. The slate triangle "mountain" (drawn by TriangleCanvas) sits
// in front. No CSS blend layers, no runtime SVG filters, and — critically —
// no `getImageData`/per-pixel JS (locked anti-pattern, POLISH-STRATEGY.md):
// every blob is a plain radial-gradient fill, GPU-composited. Baked once per
// resize; per-frame cost is zero.

// Vertical gradient stops, sampled directly from the reference photo (11-point
// row-average scan): light at the top and bottom, a deeper blue-teal band
// centered around 40% of the height.
const SKY_STOPS = [
  { t: 0.00, color: '#CAD8DD' },
  { t: 0.10, color: '#B9CFD9' },
  { t: 0.20, color: '#A9C6D4' },
  { t: 0.30, color: '#99BED1' },
  { t: 0.42, color: '#8FB8CE' },
  { t: 0.55, color: '#97BED2' },
  { t: 0.65, color: '#9BC0D3' },
  { t: 0.75, color: '#A6C7D8' },
  { t: 0.85, color: '#AFCDDB' },
  { t: 0.93, color: '#BDD5DF' },
  { t: 1.00, color: '#CCDEE4' },
]
// Blob tones — a touch lighter and a touch deeper than the local gradient
// value, sampled from the photo's per-row min/max range (~±15 RGB units).
const BLOB_LIGHT = '214,228,232'   // #D6E4E8 — soft highlight patch
const BLOB_SHADE = '139,181,203'   // #8BB5CB — soft deeper patch

function buildAlpineBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  // Base sky — the photo's sampled vertical banding.
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const stop of SKY_STOPS) sky.addColorStop(stop.t, stop.color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // Soft atmospheric variation — large overlapping blobs, no defined shapes.
  paintClouds(ctx, w, h)

  return oc
}

// ── paintClouds / blobs ───────────────────────────────────────────────────────
// Two scales of soft round blobs, both drawn with the same radial-gradient
// primitive (opaque-ish core fading fully to transparent at the edge — no hard
// rim). MASS_BLOBS are large and low-alpha, building the big soft shape seen in
// the photo; DETAIL_BLOBS are smaller and add finer local variation on top.
// Positions/sizes are fractions of (w, h) so the sky scales; each blob's seed
// only matters for reproducibility here (there's no per-blob jitter beyond the
// authored values — the irregularity comes from many overlapping soft shapes,
// not randomness).
const MASS_BLOBS = [
  { cx: 0.20, cy: 0.15, rx: 0.42, ry: 0.36, tone: BLOB_LIGHT, alpha: 0.14 },
  { cx: 0.68, cy: 0.10, rx: 0.36, ry: 0.30, tone: BLOB_LIGHT, alpha: 0.12 },
  { cx: 0.42, cy: 0.36, rx: 0.50, ry: 0.34, tone: BLOB_SHADE, alpha: 0.16 },
  { cx: 0.82, cy: 0.42, rx: 0.34, ry: 0.30, tone: BLOB_SHADE, alpha: 0.14 },
  { cx: 0.08, cy: 0.55, rx: 0.30, ry: 0.32, tone: BLOB_LIGHT, alpha: 0.11 },
  { cx: 0.55, cy: 0.62, rx: 0.38, ry: 0.32, tone: BLOB_SHADE, alpha: 0.10 },
  { cx: 0.88, cy: 0.76, rx: 0.32, ry: 0.30, tone: BLOB_LIGHT, alpha: 0.12 },
  { cx: 0.28, cy: 0.86, rx: 0.36, ry: 0.30, tone: BLOB_LIGHT, alpha: 0.10 },
]
const DETAIL_BLOBS = [
  { cx: 0.12, cy: 0.08, rx: 0.14, ry: 0.10, tone: BLOB_LIGHT, alpha: 0.10 },
  { cx: 0.38, cy: 0.06, rx: 0.12, ry: 0.09, tone: BLOB_SHADE, alpha: 0.08 },
  { cx: 0.58, cy: 0.22, rx: 0.16, ry: 0.11, tone: BLOB_SHADE, alpha: 0.10 },
  { cx: 0.30, cy: 0.28, rx: 0.13, ry: 0.10, tone: BLOB_LIGHT, alpha: 0.08 },
  { cx: 0.75, cy: 0.30, rx: 0.14, ry: 0.10, tone: BLOB_LIGHT, alpha: 0.09 },
  { cx: 0.95, cy: 0.20, rx: 0.12, ry: 0.09, tone: BLOB_SHADE, alpha: 0.07 },
  { cx: 0.18, cy: 0.46, rx: 0.14, ry: 0.10, tone: BLOB_SHADE, alpha: 0.08 },
  { cx: 0.48, cy: 0.50, rx: 0.15, ry: 0.11, tone: BLOB_LIGHT, alpha: 0.09 },
  { cx: 0.68, cy: 0.58, rx: 0.13, ry: 0.10, tone: BLOB_SHADE, alpha: 0.07 },
  { cx: 0.92, cy: 0.60, rx: 0.12, ry: 0.09, tone: BLOB_LIGHT, alpha: 0.08 },
  { cx: 0.10, cy: 0.72, rx: 0.13, ry: 0.10, tone: BLOB_LIGHT, alpha: 0.07 },
  { cx: 0.60, cy: 0.80, rx: 0.14, ry: 0.10, tone: BLOB_SHADE, alpha: 0.08 },
]

// One soft round blob — a radial gradient squashed slightly into an ellipse,
// opaque-ish at its center and fully feathered to transparent at its edge.
// Overlapping many of these is what builds the photo's smooth local variation.
function blob(ctx, cx, cy, rx, ry, rgb, alpha) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, ry / rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  g.addColorStop(0,   `rgba(${rgb},${alpha.toFixed(3)})`)
  g.addColorStop(0.6, `rgba(${rgb},${(alpha * 0.55).toFixed(3)})`)
  g.addColorStop(1,   `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function paintClouds(ctx, w, h) {
  for (const b of MASS_BLOBS)   blob(ctx, b.cx * w, b.cy * h, b.rx * w, b.ry * h, b.tone, b.alpha)
  for (const b of DETAIL_BLOBS) blob(ctx, b.cx * w, b.cy * h, b.rx * w, b.ry * h, b.tone, b.alpha)
}

// 3-side label sequence, traversed clockwise from the bottom-left vertex:
//   side 0  left face  (ascending)  — breathe in   → text tilts +up the face
//   side 1  right face (descending) — hold         → text tilts down the face
//   side 2  base       (leftward)   — breathe out  → text stays horizontal
// The base edge runs right→left, so aligning to its direction would flip the
// text upside-down; it's held at 0 (upright) instead.
const LABEL_TEXTS  = ['breathe in', 'hold', 'breathe out']
const LABEL_ANGLES = [-Math.PI / 3, Math.PI / 3, 0]

// ── TriangleGame ──────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, and
// the baked alpine-sky background. All canvas drawing, geometry, and pointer
// handling live in TriangleCanvas. No audio this pass (silent alpine theme).
export default function TriangleGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]         = useState(null)   // { labelMids, sq }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const triangleCanvasRef = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Alpine-sky background — baked once per resize ───────────────────────────
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
      el.getContext('2d').drawImage(buildAlpineBg(w, h, dpr), 0, 0)
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
    triangleCanvasRef.current?.reset()
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
      style={{ touchAction: 'none', background: '#A6C7D8' }}
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
          {/* Alpine sky — baked at resize; all texture/lighting composited in canvas-land */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <TriangleCanvas
            ref={triangleCanvasRef}
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
                    color:      'rgba(44,58,74,1)',   // cool dark slate (alpine label)
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

      {/* Vignette — a gentle cool darkening at the edges (lighter than the dark
          desert/night themes so the pale sky doesn't turn muddy). */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(40,55,75,0.20) 100%)',
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
