import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../../store/useStore'

// ── FadeLaunch ────────────────────────────────────────────────────────────────
// A simple, gentle cross-dissolve from the home carousel into a game — in line
// with breathwork / meditation apps. A soft sage veil fades up over the home
// screen, the live game is navigated in BEHIND the opaque veil, then the veil
// fades away to reveal the game. No card animation, no particles.
//
// Rendered above the router (in App), driven by the store's cardTransition
// (only the target route is used). A tap-to-settle isn't needed — the whole
// thing is ~1.1s and the veil blocks stray input while it plays. Reduced motion
// falls back to an instant cut.

const VEIL_COLOR = '#8FAE9F' // soft eucalyptus sage — bridges home and game, no flash
const FADE_IN_MS = 440 // home → opaque veil
const HOLD_MS = 140 // veil fully opaque while the game mounts behind it
const FADE_OUT_MS = 560 // veil → the revealed game

export default function FadeLaunch() {
  const cardTransition = useStore((s) => s.cardTransition)
  const endCardTransition = useStore((s) => s.endCardTransition)
  const navigate = useNavigate()
  const veilRef = useRef(null)

  // react-router hands back a new navigate identity once the location changes;
  // the effect navigates mid-flight, so keep it in a ref and key the effect only
  // on cardTransition — otherwise it would tear down and restart the fade.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!cardTransition) return
    const { route } = cardTransition

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      navigateRef.current(route)
      const t = setTimeout(() => endCardTransition(), 30)
      return () => clearTimeout(t)
    }

    const el = veilRef.current
    if (!el) return

    let navigated = false
    const goToGame = () => {
      if (navigated) return
      navigated = true
      navigateRef.current(route)
    }

    // Fade the veil up over the home screen. Commit opacity 0 with a forced
    // reflow first, so the browser always animates 0→1 (never snaps if the
    // initial paint hasn't landed yet).
    el.style.transition = 'none'
    el.style.opacity = '0'
    void el.offsetHeight // reflow
    el.style.transition = `opacity ${FADE_IN_MS}ms ease-in`
    el.style.opacity = '1'

    // Navigate the game in behind the fully-opaque veil (no visible swap)…
    const navT = setTimeout(goToGame, FADE_IN_MS)
    // …hold a beat so it paints, then fade the veil away to reveal it.
    const outT = setTimeout(() => {
      if (veilRef.current) {
        el.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`
        el.style.opacity = '0'
      }
    }, FADE_IN_MS + HOLD_MS)
    const endT = setTimeout(() => endCardTransition(), FADE_IN_MS + HOLD_MS + FADE_OUT_MS + 60)

    return () => {
      clearTimeout(navT)
      clearTimeout(outT)
      clearTimeout(endT)
      goToGame() // idempotent — never strand the user on /home
    }
  }, [cardTransition, endCardTransition])

  if (!cardTransition) return null

  return (
    <div
      ref={veilRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: VEIL_COLOR,
        opacity: 0,
        // 'auto' blocks stray input while the fade plays.
        pointerEvents: 'auto',
      }}
    />
  )
}
