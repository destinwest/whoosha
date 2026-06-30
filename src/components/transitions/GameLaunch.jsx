import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../../store/useStore'
import SquareCardPreview from '../games/square/SquareCardPreview'

// ── GameLaunch ────────────────────────────────────────────────────────────────
// Reusable home-card → game launch (rendered above the router). A calm
// "breath-bloom": the tapped card BREATHES OPEN — expanding from its on-screen rect
// to fill the viewport on a slow inhale-ease — and then cross-dissolves into the
// live game, which is revealed at full size with its chrome easing in. No fall, no
// rush, no heavy blur. It's a container-transform paced like an inhale, and a tap
// settles it instantly (never a gate for an impatient or distressed child).
//
// Reusable pattern: parameterized only by the tapped card's rect + the game route
// (from the store). Today it renders SquareCardPreview; when other games gain a
// low-stim preview they pass their own and this launch is unchanged.
//
// Game side: as the card dissolves, the breathing square resolves FROM a soft-focus
// INTO sharp (--intro-blur SETTLE_BLUR → 0) while the chrome fades in (--intro-ui
// 0 → 1) — so the world arrives into focus instead of just appearing, and the
// soft-focus also hides any faint track cross-fade ghost. The meadow stays sharp
// (cheaper, and it keeps the focus pull on the breath). Scale is held at rest.

// Two independent phases: a quick breathe-OPEN, then a long, deliberate DISSOLVE.
const ZOOM_MS     = 600     // the breathe-open: card → full coverage (quick)
const ZOOM_EASE   = 'cubic-bezier(.22,.61,.30,1)'  // opens, then eases to full
const DISSOLVE_MS = 1320    // the card→game crossfade — long + deliberate
const SETTLE_BLUR = 5       // px — the breathing square resolves from this soft-focus to 0
const NAV_FRAC    = 0.68    // navigate at this fraction of the zoom — the ease only covers
                            // the viewport ~60% through, so navigating earlier would flash
                            // the carousel→game swap around the card's edges

export default function GameLaunch() {
  const cardTransition    = useStore((s) => s.cardTransition)
  const endCardTransition = useStore((s) => s.endCardTransition)
  const navigate          = useNavigate()
  const overlayRef        = useRef(null)

  // react-router hands back a new navigate identity once the location changes; the
  // effect navigates mid-flight, so keep it in a ref and key the effect only on
  // cardTransition — otherwise it tears down and restarts the bloom.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!cardTransition) return
    const el = overlayRef.current
    if (!el) return
    const { fromRect, route } = cardTransition
    const root = document.documentElement

    const setUi = (v) => root.style.setProperty('--intro-ui', v.toFixed(3))
    // Hold the game fully arrived at rest. Runs on every exit path so an interrupted
    // launch never strands the game scaled / blurred / chrome-less.
    const resetGame = () => {
      root.style.setProperty('--intro-scale', '1')
      root.style.setProperty('--intro-blur', '0px')
      root.style.setProperty('--introbg-scale', '1')
      root.style.setProperty('--introbg-blur', '0px')
      root.style.setProperty('--intro-ui', '1')
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      // No bloom — an instant cut respects vestibular sensitivity.
      navigateRef.current(route)
      const t = setTimeout(() => endCardTransition(), 30)
      return () => { clearTimeout(t); resetGame() }
    }

    const vw = window.innerWidth, vh = window.innerHeight
    // cover = the scale at which the card just fills the viewport (1.06 over-scale
    // clears the rounded corners).
    const cover = Math.max(vw / fromRect.width, vh / fromRect.height) * 1.06
    const dx = vw / 2 - (fromRect.left + fromRect.width / 2)
    const dy = vh / 2 - (fromRect.top + fromRect.height / 2)

    let finished = false
    let settleRaf

    // ── Breathe the card open ──
    el.style.transform = 'translate(0px, 0px) scale(1)'
    el.style.opacity   = '1'
    const raf = requestAnimationFrame(() => {
      if (!overlayRef.current) return
      el.style.transition = `transform ${ZOOM_MS}ms ${ZOOM_EASE}`
      el.style.transform  = `translate(${dx}px, ${dy}px) scale(${cover})`
    })

    // Navigate while the bloom is full-screen and opaque — the game paints behind
    // it (chrome hidden) so the dissolve reveals an already-painted world.
    const navTimer = setTimeout(() => {
      // Arm the breathing square soft-focus + chrome hidden, behind the (opaque) card.
      root.style.setProperty('--intro-blur', `${SETTLE_BLUR}px`)
      setUi(0)
      navigateRef.current(route)
    }, ZOOM_MS * NAV_FRAC)

    // Dissolve the card into the game and ease the chrome in as it settles.
    const fadeTimer = setTimeout(() => {
      if (overlayRef.current) {
        overlayRef.current.style.transition = `opacity ${DISSOLVE_MS}ms ease`
        overlayRef.current.style.opacity = '0'
      }
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / DISSOLVE_MS)
        // The world resolves INTO focus as the card dissolves — the breathing square
        // clears from soft-focus (this also softens any faint track cross-fade ghost).
        root.style.setProperty('--intro-blur', `${(SETTLE_BLUR * (1 - t)).toFixed(2)}px`)
        setUi(Math.max(0, (t - 0.3) / 0.7))   // chrome eases in over the back of the dissolve
        if (t < 1) settleRaf = requestAnimationFrame(step)
        else resetGame()
      }
      settleRaf = requestAnimationFrame(step)
    }, ZOOM_MS)

    const endTimer = setTimeout(() => endCardTransition(), ZOOM_MS + DISSOLVE_MS + 80)

    // Tap to settle instantly — quick graceful fade, never a hard cut.
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(navTimer); clearTimeout(fadeTimer); clearTimeout(endTimer)
      cancelAnimationFrame(settleRaf)
      navigateRef.current(route)   // idempotent if already navigated
      resetGame()
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'opacity 180ms ease'
        overlayRef.current.style.opacity = '0'
      }
      setTimeout(() => endCardTransition(), 200)
    }
    el.addEventListener('pointerdown', finish)

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(settleRaf)
      clearTimeout(navTimer); clearTimeout(fadeTimer); clearTimeout(endTimer)
      el.removeEventListener('pointerdown', finish)
      resetGame()
    }
  }, [cardTransition, endCardTransition])

  if (!cardTransition) return null
  const { fromRect } = cardTransition

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        top: fromRect.top,
        left: fromRect.left,
        width: fromRect.width,
        height: fromRect.height,
        transformOrigin: 'center center',
        zIndex: 9999,
        borderRadius: '1.5rem',
        overflow: 'hidden',
        // 'auto' so the overlay catches a tap-to-settle and blocks stray input mid-bloom.
        pointerEvents: 'auto',
        willChange: 'transform, opacity',
      }}
    >
      <SquareCardPreview className="w-full h-full" />
    </div>
  )
}
