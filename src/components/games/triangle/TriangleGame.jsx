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

// ── buildSkyBg ────────────────────────────────────────────────────────────────
// Bakes the entire static background into a single offscreen canvas at
// device-pixel resolution. Design brief (2026-07-13): the child is looking
// across a vast hazy mountain chain toward a bright expansive sky — so the
// vertical gradient is INVERTED from a typical sky photo: darker, grayer,
// LESS saturated gray-periwinkle at the bottom (the hazy horizon), rising to
// a lighter, bluer, MORE saturated top. The scenery is a stack of wavy,
// low-contrast ridgeline silhouettes (round-1's "ridge haze" direction,
// chosen over three flat-cloud-mass alternatives — see git history for the
// losing variants) — no cloud shapes at all now, just distant mountain
// ridges receding into haze. The slate triangle "mountain" (drawn by
// TriangleCanvas) is the foreground peak.
//
// ROUND-2 EXPLORATION (2026-07-13 follow-up): four ridge-count/spacing
// variants live behind the dev-only tap switcher (DEV_SKY_SWITCHER below)
// for on-device comparison — 2-3 ridges packed tight near the bottom
// (nearest, most opaque), 2-5 more ridges spreading apart with growing,
// irregular gaps toward the top (farthest, faintest — atmospheric
// perspective). Strip the switcher and losing variants once a spacing
// pattern is picked.
//
// Every ridge is one flat filled path — no CSS blend layers, no runtime SVG
// filters, and no `getImageData`/per-pixel JS (locked anti-pattern,
// POLISH-STRATEGY.md). Baked once per resize (and per switcher tap);
// per-frame cost is zero.

// Show the round-1 variant-cycling button. Strip (with the losing paint
// functions) once a sky direction is chosen.
const DEV_SKY_SWITCHER = true

// Vertical gradient stops, top → bottom: light saturated blue up high, sinking
// through periwinkle into a darker, grayer, desaturated horizon band.
const SKY_STOPS = [
  { t: 0.00, color: '#98BCE4' },
  { t: 0.22, color: '#A0BCDC' },
  { t: 0.45, color: '#A6B3CE' },
  { t: 0.68, color: '#9DA3BC' },
  { t: 0.86, color: '#9095A9' },
  { t: 1.00, color: '#888C9E' },
]

function buildSkyBg(w, h, dpr, variant) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const stop of SKY_STOPS) sky.addColorStop(stop.t, stop.color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  SKY_VARIANTS[variant].paint(ctx, w, h)
  return oc
}

// ── wavy ridge primitive ──────────────────────────────────────────────────────
// A single ridgeline silhouette: a smooth wavy curve (sum of two sines — a
// broad primary wave plus a smaller secondary one for organic irregularity,
// not a mechanical single sine) filled from the curve down past the bottom
// edge. Later ridges are drawn on top of earlier ones, so painting a stack
// farthest-first/nearest-last gives correct front-to-back occlusion for free.
// All position/size args are fractions of (w, h) so the sky scales cleanly.
function wavyRidge(ctx, w, h, color, { yBase, amp, wavelen, phase, amp2, wavelen2, phase2 }) {
  const STEPS = 22
  const pts = []
  for (let i = 0; i <= STEPS; i++) {
    const fx = -0.05 + (1.10 * i) / STEPS
    const fy = yBase
      + amp  * Math.sin((2 * Math.PI * fx) / wavelen  + phase)
      + amp2 * Math.sin((2 * Math.PI * fx) / wavelen2 + phase2)
    pts.push([fx, fy])
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(pts[0][0] * w, pts[0][1] * h)
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    ctx.quadraticCurveTo(x1 * w, y1 * h, ((x1 + x2) / 2) * w, ((y1 + y2) / 2) * h)
  }
  const [lx, ly] = pts[pts.length - 1]
  ctx.lineTo(lx * w, ly * h)
  ctx.lineTo(1.05 * w, 1.1 * h)
  ctx.lineTo(-0.05 * w, 1.1 * h)
  ctx.closePath()
  ctx.fill()
}

const lerp    = (a, b, t) => a + (b - a) * t
const lerpRgb = (a, b, t) => [0, 1, 2].map(i => Math.round(lerp(a[i], b[i], t)))

// Far ridges: subtle amplitude, long lazy wavelength, faint pale-periwinkle —
// read as distant and hazy. Near ridges: more amplitude, tighter wavelength,
// darker/more opaque gray — read as close and solid. Every layer in between
// interpolates, so a stack automatically reads as receding into the distance
// regardless of how many layers or how they're spaced.
const RIDGE_FAR  = { amp: 0.010, wavelen: 0.60, alpha: 0.15, rgb: [150, 164, 190] }
const RIDGE_NEAR = { amp: 0.022, wavelen: 0.24, alpha: 0.36, rgb: [96, 100, 124] }

// Paints one ridge stack from a list of yBase positions given farthest-first
// (smallest y, highest on screen) to nearest-last (largest y, lowest on
// screen) — draw order doubles as depth order. `seed` just varies wave phase
// between variants that happen to reuse similar y-spacing.
function paintRidgeStack(ctx, w, h, ys, seed) {
  const n = ys.length
  ys.forEach((yBase, i) => {
    const t     = n === 1 ? 0 : i / (n - 1)
    const amp   = lerp(RIDGE_FAR.amp, RIDGE_NEAR.amp, t)
    const wavelen = lerp(RIDGE_FAR.wavelen, RIDGE_NEAR.wavelen, t)
    const alpha = lerp(RIDGE_FAR.alpha, RIDGE_NEAR.alpha, t)
    const rgb   = lerpRgb(RIDGE_FAR.rgb, RIDGE_NEAR.rgb, t)
    const phase = seed + i * 0.9
    wavyRidge(ctx, w, h, `rgba(${rgb.join(',')},${alpha.toFixed(3)})`, {
      yBase, amp, wavelen, phase,
      amp2: amp * 0.35, wavelen2: wavelen * 0.4, phase2: phase * 1.7 + 1,
    })
  })
}

// ── round-2 candidate spacings ────────────────────────────────────────────────
// Each variant is just a list of yBase positions, farthest (top) to nearest
// (bottom): 2-3 packed tight near the bottom edge, then 2-5 more climbing
// upward with growing, irregular gaps. Counts/patterns vary across the four
// so they can be compared side by side.

// 3 tight + 2 sparse (5 total) — moderate spread, gaps roughly doubling
const RIDGE_YS_A = [0.30, 0.62, 0.90, 0.945, 0.985]
// 2 tight + 4 sparse (6 total) — busier upper climb, gaps growing steadily
const RIDGE_YS_B = [0.10, 0.30, 0.52, 0.76, 0.92, 0.97]
// 3 tight + 5 sparse (8 total) — densest, most ridges visible top to bottom
const RIDGE_YS_C = [0.06, 0.20, 0.36, 0.54, 0.74, 0.88, 0.93, 0.97]
// 2 tight + 3 sparse (5 total) — most irregular gap sizes, least mechanical
const RIDGE_YS_D = [0.15, 0.46, 0.72, 0.91, 0.96]

const SKY_VARIANTS = [
  { name: '3+2 climb',      paint: (ctx, w, h) => paintRidgeStack(ctx, w, h, RIDGE_YS_A, 0.4) },
  { name: '2+4 climb',      paint: (ctx, w, h) => paintRidgeStack(ctx, w, h, RIDGE_YS_B, 1.1) },
  { name: '3+5 dense',      paint: (ctx, w, h) => paintRidgeStack(ctx, w, h, RIDGE_YS_C, 2.0) },
  { name: '2+3 scattered',  paint: (ctx, w, h) => paintRidgeStack(ctx, w, h, RIDGE_YS_D, 0.7) },
]

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
// the baked mountain-sky background. All canvas drawing, geometry, and pointer
// handling live in TriangleCanvas. No audio this pass (silent alpine theme).
export default function TriangleGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')
  const [labelGeo, setLabelGeo]         = useState(null)   // { labelMids, sq }
  const [skyVariant, setSkyVariant]     = useState(0)      // round-1 dev switcher index

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const triangleCanvasRef = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Mountain-sky background — baked once per resize (and per variant tap) ───
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
      el.getContext('2d').drawImage(buildSkyBg(w, h, dpr, skyVariant), 0, 0)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [skyVariant])

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
      style={{ touchAction: 'none', background: '#A6B3CE' }}
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
          {/* Mountain sky — baked at resize; all texture/lighting composited in canvas-land */}
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

      {/* round-1 sky variant switcher — dev only, stripped once a direction is
          picked. Sits above the vignette (z-15) so it stays tappable. */}
      {DEV_SKY_SWITCHER && phase === 'game' && (
        <button
          onClick={() => setSkyVariant((skyVariant + 1) % SKY_VARIANTS.length)}
          className="absolute bottom-4 right-4 z-20 h-9 px-3 flex items-center rounded-2xl bg-slate-700/15 text-slate-700 text-sm font-semibold hover:bg-slate-700/25 active:bg-slate-700/30 transition-colors"
          style={{ fontFamily: "'Nunito', sans-serif" }}
        >
          sky {skyVariant + 1}/{SKY_VARIANTS.length} — {SKY_VARIANTS[skyVariant].name}
        </button>
      )}

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
