import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../../store/useStore'
import { HOME_GAMES, GAME_GRADIENTS } from '../../data/games'
import GameShape from './GameShape'
import SquareCardPreview from './square/SquareCardPreview'
import HexagonCardPreview from './hexagon/HexagonCardPreview'
import InfinityCardPreview from './infinity/InfinityCardPreview'

// ── Tunable layout constants ──────────────────────────────────────────────────
const CARD_W       = 200    // px
const CARD_H       = 280    // px
const PIVOT_Y      = 380    // px — distance below card center where the fan pivots
const ROT_PER_STEP = 11     // deg
const SCALE_STEP   = 0.05   // per step
const MIN_SCALE    = 0.80
const MAX_VISIBLE  = 4      // cards within this distance from center are visible

const TRANSITION = 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease'

// ── LockBadge ─────────────────────────────────────────────────────────────────
function LockBadge() {
  return (
    <div
      aria-hidden="true"
      className="absolute top-3.5 right-3.5 w-8 h-8 rounded-[10px] grid place-items-center text-white"
      style={{
        background: 'rgba(62, 94, 82, 0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 5,
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </div>
  )
}

// ── ChevronButton ─────────────────────────────────────────────────────────────
// Hidden on touch-primary devices via the parent wrapper's CSS query.
function ChevronButton({ direction, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'prev' ? 'previous game' : 'next game'}
      className="grid place-items-center w-14 h-14 rounded-full border-0 text-text-forest text-2xl font-bold transition disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
      style={{
        background: 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {direction === 'prev' ? '‹' : '›'}
    </button>
  )
}

// ── Compute per-card style ────────────────────────────────────────────────────
function cardStyle(distance) {
  const absDist = Math.abs(distance)
  const rot     = distance * ROT_PER_STEP
  const scale   = Math.max(MIN_SCALE, 1 - absDist * SCALE_STEP)
  const visible = absDist <= MAX_VISIBLE
  return {
    position: 'absolute',
    top: 0,
    left: '50%',
    width: CARD_W,
    height: CARD_H,
    marginLeft: -CARD_W / 2,
    transformOrigin: `50% ${PIVOT_Y}px`,
    transform: `rotate(${rot}deg) scale(${scale})`,
    zIndex: 10 - absDist,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    cursor: 'pointer',
    transition: TRANSITION,
    willChange: 'transform',
  }
}

// ── CarouselCard ──────────────────────────────────────────────────────────────
// Pure visual — clicks bubble up to the carousel-level handler.
function CarouselCard({ game, distance }) {
  const isSquare  = game.gameKey === 'square'
  const isHexagon = game.gameKey === 'hexagon'
  const hasPreview = isSquare || isHexagon   // full-bleed track render + bottom title
  return (
    <div data-card-index="" style={cardStyle(distance)}>
      {game.locked && <LockBadge />}
      <div
        className="w-full h-full rounded-3xl overflow-hidden relative"
        style={{
          // Preview canvases paint their own soft background; the solid here is
          // just a fallback behind them. Others use the flat gradient.
          background: isSquare
            ? '#8FAE9F'
            : isHexagon
              ? '#D99E6A'
              : (GAME_GRADIENTS[game.gameKey] ?? GAME_GRADIENTS.placeholder),
          boxShadow: '0 12px 32px rgba(62, 94, 82, 0.22), 0 2px 6px rgba(62, 94, 82, 0.12)',
          filter: game.placeholder
            ? 'blur(1.5px) saturate(0.4)'
            : game.locked
              ? 'blur(2px) saturate(0.55)'
              : 'none',
          transition: 'filter 250ms ease',
        }}
      >
        {hasPreview ? (
          // Full-bleed game thumbnail: the track render fills the whole card,
          // with the title floated near the bottom (no label bar).
          <>
            {isSquare
              ? <SquareCardPreview className="absolute inset-0 w-full h-full rounded-3xl" />
              : <HexagonCardPreview className="absolute inset-0 w-full h-full rounded-3xl" />}
            <div
              className="absolute inset-x-0 px-3 text-center pointer-events-none font-display text-[18px] leading-tight font-semibold"
              style={{ top: '86%', transform: 'translateY(-50%)', color: isSquare ? '#3A5A4D' : '#5C2E1C' }}
            >
              {game.name}
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 py-6 text-center">
            <div className="w-[110px] h-[110px] grid place-items-center">
              <GameShape kind={game.shape} className="w-full h-full" />
            </div>
            <div
              className={`font-display text-[19px] leading-tight ${game.placeholder ? 'italic text-text-sage' : 'font-semibold text-text-forest'}`}
              style={{ fontWeight: game.placeholder ? 500 : 600 }}
            >
              {game.name}
            </div>
            {game.tagline && (
              <div className="text-xs text-text-sage -mt-2">{game.tagline}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ComingSoonOverlay ─────────────────────────────────────────────────────────
function ComingSoonOverlay({ visible, onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      className="absolute inset-0 grid place-items-center text-white font-display text-3xl font-semibold transition-opacity duration-250"
      style={{
        background: 'rgba(62, 94, 82, 0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: 1000,
        letterSpacing: '0.3px',
      }}
    >
      <div
        className="rounded-2xl"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          padding: '22px 40px',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.32)',
        }}
      >
        Coming Soon
      </div>
    </div>
  )
}

// ── GameCarousel ──────────────────────────────────────────────────────────────
export default function GameCarousel() {
  const navigate            = useNavigate()
  const activeIndex         = useStore((s) => s.homeActiveCardIndex)
  const setActiveIndex      = useStore((s) => s.setHomeActiveCardIndex)
  const startCardTransition = useStore((s) => s.startCardTransition)
  const [comingSoonVisible, setComingSoonVisible] = useState(false)
  const wrapRef             = useRef(null)
  const dragStartRef        = useRef(null)
  const comingSoonTimerRef  = useRef(null)

  function go(delta) {
    const next = Math.max(0, Math.min(HOME_GAMES.length - 1, activeIndex + delta))
    if (next !== activeIndex) setActiveIndex(next)
  }

  function flashComingSoon() {
    setComingSoonVisible(true)
    clearTimeout(comingSoonTimerRef.current)
    comingSoonTimerRef.current = setTimeout(() => setComingSoonVisible(false), 1400)
  }

  function handleCardClick(idx, e) {
    if (idx !== activeIndex) {
      setActiveIndex(idx)
      return
    }
    const game = HOME_GAMES[idx]
    if (game.locked || !game.route) {
      flashComingSoon()
      return
    }
    // Every unlocked game launches with the cross-dissolve transition: capture
    // the card's on-screen rect and let the app-level overlay (FadeLaunch) take
    // over (it navigates). FadeLaunch is route-driven and game-agnostic, so any
    // game reaching here (locked / route-less cards already returned above)
    // uses the exact same veil. Direct navigate is the fallback if we can't
    // read the card rect.
    const cardEl = e?.currentTarget?.querySelector('[data-card-index]')
    const rect   = cardEl?.getBoundingClientRect()
    if (rect && rect.width) {
      startCardTransition(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        game.route,
      )
      return
    }
    navigate(game.route)
  }

  // ── Keyboard arrow navigation ──────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(+1) }
      if (e.key === 'Enter')      { handleCardClick(activeIndex) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  // ── Swipe via pointer events ───────────────────────────────────────────────
  useEffect(() => {
    const SWIPE_THRESHOLD = 40
    const el = wrapRef.current
    if (!el) return

    function onPointerDown(e) {
      dragStartRef.current = e.clientX
    }
    function onPointerUp(e) {
      const startX = dragStartRef.current
      dragStartRef.current = null
      if (startX === null) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        go(dx < 0 ? +1 : -1)
      }
    }
    function onPointerCancel() {
      dragStartRef.current = null
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  // ── Cleanup timers on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => clearTimeout(comingSoonTimerRef.current)
  }, [])

  return (
    <>
      <div
        ref={wrapRef}
        className="carousel-wrap relative w-full max-w-[900px] mx-auto grid items-center gap-2"
        style={{
          gridTemplateColumns: '56px 1fr 56px',
          height: 360,
          touchAction: 'pan-y',
        }}
      >
        <div className="grid place-items-center">
          <ChevronButton direction="prev" onClick={() => go(-1)} disabled={activeIndex === 0} />
        </div>

        <div className="relative h-full">
          {HOME_GAMES.map((game, i) => {
            const distance = i - activeIndex
            return (
              <div key={game.id} onClick={(e) => handleCardClick(i, e)}>
                <CarouselCard game={game} distance={distance} />
              </div>
            )
          })}
        </div>

        <div className="grid place-items-center">
          <ChevronButton direction="next" onClick={() => go(+1)} disabled={activeIndex === HOME_GAMES.length - 1} />
        </div>
      </div>

      <ComingSoonOverlay visible={comingSoonVisible} onDismiss={() => setComingSoonVisible(false)} />

      {/* Touch-primary devices hide chevrons and collapse the grid to one column */}
      <style>{`
        @media (hover: none) and (pointer: coarse) {
          .carousel-wrap > div:first-child,
          .carousel-wrap > div:last-child { display: none !important; }
          .carousel-wrap { grid-template-columns: 1fr !important; padding: 0 24px !important; }
        }
      `}</style>
    </>
  )
}
