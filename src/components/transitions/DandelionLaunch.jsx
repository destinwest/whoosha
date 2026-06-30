import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../../store/useStore'
import { createDandelionField, DANDELION_PARAMS } from './dandelionField'

// ── DandelionLaunch ───────────────────────────────────────────────────────────
// The home-card → game launch (rendered above the router, replacing the prior
// breath-bloom). On tap, the tapped card dissolves into a field of round, soft
// dandelion-like puffs that proliferate to a near-full whiteout; the live game
// is navigated in BEHIND that cover; then the game's first breath — a synthesized
// whoosh (Phase 2) — sweeps the seeds off-screen to reveal it.
//
// Reusable across games: parameterized only by the tapped card's rect + the
// target route (from the store's cardTransition). The whole effect lives on ONE
// full-screen canvas that mounts only for the transition and unmounts the instant
// it completes — so it never costs a persistent compositing layer in gameplay.
//
// A tap-to-settle isn't wired yet; the overlay simply blocks stray input while
// it plays (it's ~2.7s) and a safety timer guarantees the transition always ends.

export default function DandelionLaunch() {
  const cardTransition = useStore((s) => s.cardTransition)
  const endCardTransition = useStore((s) => s.endCardTransition)
  const navigate = useNavigate()
  const canvasRef = useRef(null)

  // react-router hands back a new navigate identity once the location changes;
  // the effect navigates mid-flight, so keep it in a ref and key the effect only
  // on cardTransition — otherwise it would tear down and restart the launch.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!cardTransition) return
    const { fromRect, route } = cardTransition

    // Hold the game arrived-at-rest. Runs on every exit path so a prior bloom
    // (or an interrupted launch) never strands the game scaled / blurred /
    // chrome-less via leftover CSS vars.
    const resetGameVars = () => {
      const root = document.documentElement
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
      return () => { clearTimeout(t); resetGameVars() }
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const originRect = {
      cx: fromRect.left + fromRect.width / 2,
      cy: fromRect.top + fromRect.height / 2,
      w: fromRect.width,
      h: fromRect.height,
    }

    let navigated = false
    const goToGame = () => {
      if (navigated) return
      navigated = true
      resetGameVars()            // the game mounts sharp behind the whiteout
      navigateRef.current(route)
    }

    const field = createDandelionField(canvas, {
      originRect,
      onPeak: goToGame,          // navigate the game in at max coverage
      onBlow: () => {},          // Phase 2: play the breath whoosh here
      onDone: () => endCardTransition(),
    })

    // Safety: end the transition even if onDone never fires (e.g. backgrounded
    // tab pauses rAF). Sized to the full timeline + a generous buffer.
    const safetyMs = DANDELION_PARAMS.emit + DANDELION_PARAMS.hold + DANDELION_PARAMS.blow + 1200
    const safety = setTimeout(() => endCardTransition(), safetyMs)

    return () => {
      field.stop()
      clearTimeout(safety)
      goToGame()                 // idempotent — never strand the user on /home
      resetGameVars()
    }
  }, [cardTransition, endCardTransition])

  if (!cardTransition) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        // 'auto' blocks stray input mid-launch (the carousel/game sit underneath).
        pointerEvents: 'auto',
      }}
    />
  )
}
