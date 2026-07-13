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
// Ridge count/spacing is now locked to round 2's winning pick, "2+3
// scattered" (RIDGE_YS below) — 2 ridges packed tight near the bottom, 3
// more climbing upward with irregular gaps.
//
// ROUND-3 EXPLORATION (2026-07-13 follow-up): composition is fixed; only
// color intensity varies now. Four palette variants live behind the same
// dev-only tap switcher (DEV_SKY_SWITCHER below), spanning muted → vibrant.
// Every stop in the sky gradient and every ridge color is authored once as
// HSL and scaled by one shared (saturation multiplier, lightness shift) pair
// per variant — bg and ridges shift together as one cohesive palette instead
// of being tuned separately. Strip the switcher once a palette is picked.
//
// Every ridge is one flat filled path — no CSS blend layers, no runtime SVG
// filters, and no `getImageData`/per-pixel JS (locked anti-pattern,
// POLISH-STRATEGY.md). Baked once per resize (and per switcher tap);
// per-frame cost is zero.

// Show the variant-cycling button. Strip once a sky direction is chosen.
const DEV_SKY_SWITCHER = true

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// Scales one HSL(+alpha) color by a palette's saturation multiplier and
// lightness shift — the single knob every muted/vibrant variant turns.
function paletteColor(h, s, l, pal, alpha) {
  const ss = clamp(s * pal.satMul, 0, 100)
  const ll = clamp(l + pal.lightShift, 0, 100)
  return alpha === undefined
    ? `hsl(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)},${ss.toFixed(1)}%,${ll.toFixed(1)}%,${alpha})`
}

// Vertical gradient stops, top → bottom: light saturated blue up high, sinking
// through periwinkle into a darker, grayer, desaturated horizon band. Authored
// as HSL (sampled from the approved round-2 gradient) so palette variants can
// scale saturation/lightness uniformly via paletteColor().
const SKY_STOPS = [
  { t: 0.00, h: 211, s: 58.0, l: 74.5 },
  { t: 0.22, h: 212, s: 46.0, l: 74.5 },
  { t: 0.45, h: 220, s: 29.0, l: 73.0 },
  { t: 0.68, h: 228, s: 19.0, l: 67.6 },
  { t: 0.86, h: 228, s: 12.7, l: 61.4 },
  { t: 1.00, h: 229, s: 10.2, l: 57.7 },
]

// Muted → vibrant: saturation multiplier climbs, lightness shift falls (more
// saturated reads muddy without also deepening slightly — vibrant leans
// richer/darker, muted leans flatter/lighter, matching how those words read
// in a photo, not just a raw saturation slider).
const PALETTE_VARIANTS = [
  { name: 'muted',   satMul: 0.50, lightShift:  3.5 },
  { name: 'soft',    satMul: 0.85, lightShift:  1.5 },
  { name: 'rich',    satMul: 1.25, lightShift: -1.0 },
  { name: 'vibrant', satMul: 1.60, lightShift: -3.0 },
]

function buildSkyBg(w, h, dpr, variant) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)
  const pal = PALETTE_VARIANTS[variant]

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const stop of SKY_STOPS) sky.addColorStop(stop.t, paletteColor(stop.h, stop.s, stop.l, pal))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  paintRidgeStack(ctx, w, h, RIDGE_YS, 0.7, pal)
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

const lerp = (a, b, t) => a + (b - a) * t

// Far ridges: subtle amplitude, long lazy wavelength, faint pale-periwinkle —
// read as distant and hazy. Near ridges: more amplitude, tighter wavelength,
// darker/more opaque gray — read as close and solid. Every layer in between
// interpolates, so a stack automatically reads as receding into the distance
// regardless of how many layers or how they're spaced. Authored as HSL for
// the same reason as SKY_STOPS above.
const RIDGE_FAR  = { amp: 0.010, wavelen: 0.60, alpha: 0.15, h: 219, s: 23.5, l: 66.7 }
const RIDGE_NEAR = { amp: 0.022, wavelen: 0.24, alpha: 0.36, h: 231, s: 12.7, l: 43.1 }

// 2 tight + 3 sparse (5 total), the winning round-2 spacing: 2 ridges packed
// close to the bottom edge, 3 more climbing up with irregular gaps.
const RIDGE_YS = [0.15, 0.46, 0.72, 0.91, 0.96]

// Paints one ridge stack from a list of yBase positions given farthest-first
// (smallest y, highest on screen) to nearest-last (largest y, lowest on
// screen) — draw order doubles as depth order. `seed` varies wave phase so
// ridges don't look like parallel copies; `pal` applies the same
// muted/vibrant scaling as the sky gradient.
function paintRidgeStack(ctx, w, h, ys, seed, pal) {
  const n = ys.length
  ys.forEach((yBase, i) => {
    const t       = n === 1 ? 0 : i / (n - 1)
    const amp     = lerp(RIDGE_FAR.amp, RIDGE_NEAR.amp, t)
    const wavelen = lerp(RIDGE_FAR.wavelen, RIDGE_NEAR.wavelen, t)
    const alpha   = lerp(RIDGE_FAR.alpha, RIDGE_NEAR.alpha, t)
    const hue     = lerp(RIDGE_FAR.h, RIDGE_NEAR.h, t)
    const sat     = lerp(RIDGE_FAR.s, RIDGE_NEAR.s, t)
    const light   = lerp(RIDGE_FAR.l, RIDGE_NEAR.l, t)
    const phase   = seed + i * 0.9
    wavyRidge(ctx, w, h, paletteColor(hue, sat, light, pal, alpha), {
      yBase, amp, wavelen, phase,
      amp2: amp * 0.35, wavelen2: wavelen * 0.4, phase2: phase * 1.7 + 1,
    })
  })
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

      {/* sky palette switcher — dev only, stripped once a direction is picked.
          Sits above the vignette (z-15) so it stays tappable. */}
      {DEV_SKY_SWITCHER && phase === 'game' && (
        <button
          onClick={() => setSkyVariant((skyVariant + 1) % PALETTE_VARIANTS.length)}
          className="absolute bottom-4 right-4 z-20 h-9 px-3 flex items-center rounded-2xl bg-slate-700/15 text-slate-700 text-sm font-semibold hover:bg-slate-700/25 active:bg-slate-700/30 transition-colors"
          style={{ fontFamily: "'Nunito', sans-serif" }}
        >
          sky {skyVariant + 1}/{PALETTE_VARIANTS.length} — {PALETTE_VARIANTS[skyVariant].name}
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
