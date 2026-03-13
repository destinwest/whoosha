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
//   icon        — ReactNode — the SVG icon element (must use inline stroke colors)
//   route       — string e.g. '/games/square'
//   active      — boolean — false = locked, pointer-events none
//   bg          — string — Tailwind bg class e.g. 'bg-secondary'
//   onZoomStart — () => void — called when zoom sequence begins (parent fades)
export default function GameCard({ id, label, description, icon, route, active, bg, onZoomStart }) {
  const navigate       = useNavigate()
  const iconWrapperRef = useRef(null)
  const cloneRef       = useRef(null)
  const zoomActiveRef  = useRef(false)
  const cancelRef      = useRef(null)
  const navTimerRef    = useRef(null)
  const mountedRef     = useRef(true)
  const [zoomState, setZoomState] = useState(null)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      cancelRef.current?.()
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
    }
  }, [])

  function handleTap() {
    if (!active || zoomActiveRef.current) return

    // Respect reduced-motion preference — skip animation, navigate directly
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(route)
      return
    }

    zoomActiveRef.current = true

    const rect        = iconWrapperRef.current.getBoundingClientRect()
    const diagonal    = Math.hypot(window.innerWidth, window.innerHeight)
    const targetScale = (diagonal / rect.width) * 2.6

    // Mount the overlay clone before starting the animation
    setZoomState({ originRect: rect, targetScale })
    onZoomStart?.()

    // One rAF delay ensures ZoomOverlay has mounted and cloneRef is set
    requestAnimationFrame(() => {
      cancelRef.current = animVal(1, targetScale, 650, easeInQuart, (s) => {
        if (cloneRef.current) cloneRef.current.style.transform = `scale(${s})`
      }, () => {
        if (cloneRef.current) cloneRef.current.style.opacity = '0'
      })

      // Navigate at 85% of zoom duration — game route mounts dark, no flash
      navTimerRef.current = setTimeout(() => navigate(route), 552)

      // Fallback: if navigation failed and we're still mounted after 800ms,
      // reset fading state so the home screen is usable again
      setTimeout(() => {
        if (mountedRef.current) {
          cancelRef.current?.()
          setZoomState(null)
          zoomActiveRef.current = false
          // Signal parent to restore opacity — reuse onZoomStart with reset flag
          // via a dedicated reset callback is cleaner, but the simplest approach:
          // the parent uses a mountedRef reset pattern (see HomePage)
        }
      }, 800)
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
        {/* icon wrapper — display:inline-block ensures it sizes to SVG, not card width */}
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
          iconNode={icon}
          originRect={zoomState.originRect}
          cloneRef={cloneRef}
        />
      )}
    </>
  )
}
