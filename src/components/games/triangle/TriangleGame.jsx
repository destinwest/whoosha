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
// a lighter, bluer, MORE saturated top. Cloud forms are flat, crisp-edged,
// abstract poster shapes — one flat fill per mass, no interior shading and no
// scallop detailing — tonal (low contrast) against the local gradient. The
// slate triangle "mountain" (drawn by TriangleCanvas) is the foreground peak.
//
// ROUND-1 EXPLORATION: four candidate compositions live side by side behind a
// dev-only tap switcher (DEV_SKY_SWITCHER below) for on-device comparison.
// The losing variants and the switcher get stripped once a direction is picked.
//
// Every shape is a flat multi-subpath fill (unioned circles — overlapping
// subpaths inside one fill() don't double-darken, so each mass reads as one
// crisp silhouette). No CSS blend layers, no runtime SVG filters, and no
// `getImageData`/per-pixel JS (locked anti-pattern, POLISH-STRATEGY.md).
// Baked once per resize (and per switcher tap); per-frame cost is zero.

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

// ── flat-shape primitives ─────────────────────────────────────────────────────
// All positions are fractions of (w, h); radii are fractions of w so shapes
// keep their aspect as the sky scales. Colors are rgba with alpha well below 1
// so every shape tints with the gradient behind it — that's what keeps the
// contrast tonal without hand-matching a color per altitude.

// One flat cloud mass — circles unioned into a single path, filled once.
// lobes: [x, y, r][]
function flatMass(ctx, w, h, color, lobes) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (const [fx, fy, fr] of lobes) {
    const r = fr * w
    ctx.moveTo(fx * w + r, fy * h)
    ctx.arc(fx * w, fy * h, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

// A cloud bank — scalloped lobes joined by a base rectangle running from yBase
// past the bottom edge, so the mass reads as a solid billowing wall.
function bank(ctx, w, h, color, yBase, lobes) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (const [fx, fy, fr] of lobes) {
    const r = fr * w
    ctx.moveTo(fx * w + r, fy * h)
    ctx.arc(fx * w, fy * h, r, 0, Math.PI * 2)
  }
  ctx.rect(-0.05 * w, yBase * h, 1.1 * w, (1.1 - yBase) * h)
  ctx.fill()
}

// A ridgeline silhouette — smooth rolling curve through pts (midpoint
// quadratics), closed past the bottom edge. pts: [x, y][]
function ridge(ctx, w, h, color, pts) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(-0.05 * w, pts[0][1] * h)
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    ctx.quadraticCurveTo(x1 * w, y1 * h, ((x1 + x2) / 2) * w, ((y1 + y2) / 2) * h)
  }
  const [lx, ly] = pts[pts.length - 1]
  ctx.quadraticCurveTo(lx * w, ly * h, 1.05 * w, ly * h)
  ctx.lineTo(1.05 * w, 1.1 * h)
  ctx.lineTo(-0.05 * w, 1.1 * h)
  ctx.closePath()
  ctx.fill()
}

// ── round-1 candidate compositions ───────────────────────────────────────────

// A — "cloud sea": layered billowing banks across the bottom, the back bank
// rising to the right (inspiration image 1's composition, flattened to poster
// shapes); two small drifters in the open upper sky.
function paintCloudSea(ctx, w, h) {
  // back bank — darker haze, highest on the right
  bank(ctx, w, h, 'rgba(150,158,182,0.30)', 0.86, [
    [0.05, 0.83, 0.10], [0.24, 0.80, 0.12], [0.46, 0.82, 0.10],
    [0.66, 0.77, 0.13], [0.88, 0.72, 0.15], [1.02, 0.70, 0.13],
  ])
  // mid bank — lighter, lower
  bank(ctx, w, h, 'rgba(188,197,218,0.32)', 0.92, [
    [0.00, 0.90, 0.09], [0.18, 0.88, 0.11], [0.40, 0.90, 0.09],
    [0.60, 0.86, 0.12], [0.83, 0.84, 0.11], [1.00, 0.86, 0.10],
  ])
  // front bank — lightest rim hugging the bottom edge
  bank(ctx, w, h, 'rgba(208,216,233,0.38)', 0.97, [
    [0.08, 0.965, 0.08], [0.30, 0.955, 0.10], [0.52, 0.965, 0.08],
    [0.74, 0.95, 0.11], [0.94, 0.96, 0.09],
  ])
  // drifters
  flatMass(ctx, w, h, 'rgba(198,211,232,0.42)', [
    [0.20, 0.155, 0.055], [0.27, 0.145, 0.07], [0.35, 0.16, 0.05],
  ])
  flatMass(ctx, w, h, 'rgba(198,211,232,0.34)', [
    [0.60, 0.075, 0.04], [0.66, 0.07, 0.05], [0.72, 0.08, 0.035],
  ])
}

// B — "quiet strata": long flat elongated wisps (inspiration image 2's
// shapes), light and sparse up top, denser and darker toward the horizon.
function paintStrata(ctx, w, h) {
  // big upper wisp
  flatMass(ctx, w, h, 'rgba(202,214,234,0.38)', [
    [0.18, 0.12, 0.07], [0.34, 0.105, 0.10], [0.55, 0.115, 0.09], [0.72, 0.13, 0.06],
  ])
  // mid-left wisp
  flatMass(ctx, w, h, 'rgba(196,207,228,0.30)', [
    [0.02, 0.34, 0.05], [0.14, 0.335, 0.07], [0.27, 0.345, 0.05],
  ])
  // small right accent
  flatMass(ctx, w, h, 'rgba(186,196,218,0.26)', [
    [0.78, 0.47, 0.04], [0.87, 0.465, 0.055], [0.95, 0.475, 0.04],
  ])
  // low strata — darker than the local gradient, hugging the horizon
  flatMass(ctx, w, h, 'rgba(118,124,146,0.20)', [
    [0.10, 0.78, 0.06], [0.28, 0.775, 0.09], [0.50, 0.785, 0.07], [0.68, 0.78, 0.08],
  ])
  flatMass(ctx, w, h, 'rgba(108,113,136,0.24)', [
    [0.30, 0.885, 0.07], [0.52, 0.88, 0.10], [0.76, 0.89, 0.08], [0.95, 0.885, 0.06],
  ])
}

// C — "diagonal channel": one big mass descending from the lower-left, one
// corner mass upper-right (inspiration image 1's diagonal sweep), and a clean
// open channel of bare gradient between them.
function paintDiagonal(ctx, w, h) {
  // lower-left mass, sinking toward the lower-right
  bank(ctx, w, h, 'rgba(196,205,226,0.34)', 0.90, [
    [-0.02, 0.72, 0.14], [0.16, 0.68, 0.15], [0.34, 0.72, 0.12],
    [0.50, 0.79, 0.11], [0.68, 0.87, 0.10], [0.90, 0.93, 0.09],
  ])
  // upper-right corner mass
  flatMass(ctx, w, h, 'rgba(200,212,233,0.36)', [
    [0.78, 0.05, 0.10], [0.92, 0.09, 0.13], [1.04, 0.03, 0.12], [0.88, -0.02, 0.10],
  ])
  // drifters in the channel
  flatMass(ctx, w, h, 'rgba(196,209,230,0.30)', [
    [0.30, 0.30, 0.045], [0.37, 0.295, 0.055], [0.44, 0.305, 0.04],
  ])
  // faint low echo, right side
  flatMass(ctx, w, h, 'rgba(150,158,182,0.24)', [
    [0.72, 0.60, 0.05], [0.82, 0.595, 0.065], [0.91, 0.605, 0.05],
  ])
}

// D — "ridge haze": two overlapping ridgeline silhouettes hint at the distant
// mountain chain (very low contrast — abstract, not literal peaks); sparse
// flat wisps in the sky above.
function paintRidges(ctx, w, h) {
  flatMass(ctx, w, h, 'rgba(202,214,234,0.36)', [
    [0.55, 0.10, 0.06], [0.67, 0.09, 0.08], [0.80, 0.105, 0.06],
  ])
  flatMass(ctx, w, h, 'rgba(194,205,227,0.28)', [
    [0.10, 0.30, 0.04], [0.19, 0.295, 0.055], [0.28, 0.305, 0.04],
  ])
  // far ridge
  ridge(ctx, w, h, 'rgba(125,130,152,0.30)', [
    [0.00, 0.845], [0.14, 0.815], [0.30, 0.845], [0.48, 0.805],
    [0.66, 0.84], [0.84, 0.81], [1.00, 0.835],
  ])
  // near ridge
  ridge(ctx, w, h, 'rgba(104,109,132,0.32)', [
    [0.00, 0.90], [0.18, 0.925], [0.38, 0.885], [0.58, 0.92],
    [0.78, 0.89], [1.00, 0.915],
  ])
}

const SKY_VARIANTS = [
  { name: 'cloud sea',        paint: paintCloudSea },
  { name: 'quiet strata',     paint: paintStrata },
  { name: 'diagonal channel', paint: paintDiagonal },
  { name: 'ridge haze',       paint: paintRidges },
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
