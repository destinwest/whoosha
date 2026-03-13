import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ZoomOverlay from '../ui/transitions/ZoomOverlay'

// ── Easing & animation ────────────────────────────────────────────────────────
const easeInQuart = t => t * t * t * t

function animVal(from, to, dur, ease, onTick, onDone) {
  const start = performance.now()
  let h
  ;(function tick(now) {
    const t = Math.min(1, (now - start) / dur)
    onTick(from + (to - from) * ease(t))
    if (t < 1) h = requestAnimationFrame(tick)
    else { onTick(to); onDone?.() }
  })(performance.now())
  return () => cancelAnimationFrame(h)
}

// Background color lerp: #9FBFB4 → #2C4A3E
const BG_FROM = { r: 159, g: 191, b: 180 }
const BG_TO   = { r: 44,  g: 74,  b: 62  }

// ── LockIcon ──────────────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-5 h-5">
      <path fillRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
        clipRule="evenodd" />
    </svg>
  )
}

// ── GameCard ──────────────────────────────────────────────────────────────────
// Props:
//   id          — string e.g. 'square'
//   label       — string e.g. 'Square Breathing'
//   description — string e.g. 'Trace the square and breathe'
//   icon        — ReactNode — SVG shown on the card (inline stroke colors)
//   zoomIcon    — ReactNode — optional alternate SVG for the zoom clone
//                 (use when the clone needs different fill/stroke than the card icon)
//   route       — string e.g. '/games/square'
//   active      — boolean — false = locked, pointer-events none
//   bg          — string — Tailwind bg class e.g. 'bg-secondary'
//   onZoomStart — () => void — called when zoom begins (parent fades home screen)
//   focalPoint  — { x, y } as fractions of icon size — the point on the icon the
//                 zoom anchors to and translates toward viewport center.
//                 Default: { x: 0.5, y: 0.5 } (icon center)
export default function GameCard({
  id, label, description, icon, zoomIcon, route, active, bg,
  onZoomStart, focalPoint = { x: 0.5, y: 0.5 },
}) {
  const navigate       = useNavigate()
  const iconWrapperRef = useRef(null)
  const cloneRef       = useRef(null)
  const bgRef          = useRef(null)
  const zoomActiveRef  = useRef(false)
  const mountedRef     = useRef(true)
  const cancels        = useRef([])   // all cancel/clearTimeout fns — drained on unmount
  const [zoomState, setZoomState] = useState(null)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      cancels.current.forEach(fn => fn())
    }
  }, [])

  function handleTap() {
    if (!active || zoomActiveRef.current) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(route)
      return
    }

    zoomActiveRef.current = true

    const rect        = iconWrapperRef.current.getBoundingClientRect()
    const diagonal    = Math.hypot(window.innerWidth, window.innerHeight)
    const targetScale = (diagonal / rect.width) * 2.6

    // The focal point in screen coordinates — this is what translates to
    // the viewport center during the zoom (the "anchor" of the dive)
    const focalScreenX = rect.left + focalPoint.x * rect.width
    const focalScreenY = rect.top  + focalPoint.y * rect.height
    const dxFinal = window.innerWidth  / 2 - focalScreenX
    const dyFinal = window.innerHeight / 2 - focalScreenY

    const transformOrigin = `${focalPoint.x * 100}% ${focalPoint.y * 100}%`

    setZoomState({ originRect: rect, transformOrigin })
    onZoomStart?.()

    requestAnimationFrame(() => {
      // Set initial rect fill before animVal starts — avoids a single-frame
      // transparent flash between ZoomOverlay mounting and first tick firing
      const rectEl = cloneRef.current?.querySelector('rect')
      if (rectEl) {
        rectEl.setAttribute('fill', `rgb(${BG_FROM.r},${BG_FROM.g},${BG_FROM.b})`)
      }

      const cancelAnim = animVal(1, targetScale, 650, easeInQuart, (s) => {
        // Normalized progress — same curve as scale since we derived s from it
        const p = targetScale === 1 ? 1 : (s - 1) / (targetScale - 1)

        const r = Math.round(BG_FROM.r + (BG_TO.r - BG_FROM.r) * p)
        const g = Math.round(BG_FROM.g + (BG_TO.g - BG_FROM.g) * p)
        const b = Math.round(BG_FROM.b + (BG_TO.b - BG_FROM.b) * p)

        // Translate focal point toward viewport center + scale from focal point
        if (cloneRef.current) {
          cloneRef.current.style.transform =
            `translate(${dxFinal * p}px, ${dyFinal * p}px) scale(${s})`
          // Rect fill transitions eucalyptus → game-intro dark alongside zoom
          cloneRef.current.querySelector('rect')?.setAttribute('fill', `rgb(${r},${g},${b})`)
        }

        // Overlay background transitions in sync — covers area outside the rect
        if (bgRef.current) {
          bgRef.current.style.background = `rgb(${r},${g},${b})`
        }
      }, () => {
        if (cloneRef.current) cloneRef.current.style.opacity = '0'
      })
      cancels.current.push(cancelAnim)

      // Navigate at 85% of zoom duration — game route mounts dark, no flash
      const navId = setTimeout(() => navigate(route), 552)
      cancels.current.push(() => clearTimeout(navId))

      // Fallback: if navigation never fires, restore home screen after 900ms
      const fallbackId = setTimeout(() => {
        if (mountedRef.current) {
          cancels.current.forEach(fn => fn())
          setZoomState(null)
          zoomActiveRef.current = false
        }
      }, 900)
      cancels.current.push(() => clearTimeout(fallbackId))
    })
  }

  return (
    <>
      <button
        onClick={handleTap}
        className={[
          'relative flex flex-col items-center justify-center gap-3',
          'rounded-3xl p-5 min-h-48 w-full text-center',
          'transition-all duration-150',
          bg,
          active
            ? 'hover:scale-[1.03] active:scale-[0.97] cursor-pointer'
            : 'grayscale opacity-40',
        ].join(' ')}
        style={{ pointerEvents: active ? 'auto' : 'none' }}
        aria-label={active ? `Play ${label}` : `${label} — coming soon`}
      >
        {/* display:inline-block ensures wrapper sizes to SVG, not card width */}
        <div ref={iconWrapperRef} style={{ display: 'inline-block' }}>
          {icon}
        </div>

        <p className="font-body font-semibold text-xl text-text-forest leading-tight">
          {label}
        </p>

        <p className="font-body text-sm text-text-forest/70 leading-snug">
          {description}
        </p>

        {!active && (
          <span className="absolute top-3 right-3 text-text-forest/50" aria-hidden="true">
            <LockIcon />
          </span>
        )}
      </button>

      {zoomState && (
        <ZoomOverlay
          iconNode={zoomIcon ?? icon}
          originRect={zoomState.originRect}
          cloneRef={cloneRef}
          bgRef={bgRef}
          transformOrigin={zoomState.transformOrigin}
        />
      )}
    </>
  )
}
