import { useState, useRef } from 'react'
import GameIntro     from '../../ui/transitions/GameIntro'
import StrokeSelector from './StrokeSelector'
import SquareCanvas   from './SquareCanvas'

// ── SquareGame ────────────────────────────────────────────────────────────────
// Phase manager — owns intro/game phase, stroke selection, session timing, exit.
// All canvas drawing, game geometry, and pointer handling live in SquareCanvas.
export default function SquareGame({ onExit, introVariant = 'fadeSettle' }) {

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState('intro')   // 'intro' | 'game'
  const [activeStroke, setActiveStroke] = useState('classic')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef = useRef(null)
  const strokeModeRef   = useRef('classic')
  const squareCanvasRef = useRef(null)

  // ── Stroke selection ────────────────────────────────────────────────────────
  function handleStrokeSelect(newStroke) {
    if (newStroke === strokeModeRef.current) return
    strokeModeRef.current = newStroke
    setActiveStroke(newStroke)
    squareCanvasRef.current?.reset()
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    onExit(dur)
  }

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      {/* back button */}
      <button
        onClick={handleExit}
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30 transition-colors"
        aria-label="Exit game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties */}
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'blur(var(--intro-blur, 0px))',
        transform: 'scale(var(--intro-scale, 1))',
        transformOrigin: 'center center',
        willChange: 'transform, filter',
      }}>
        <SquareCanvas
          ref={squareCanvasRef}
          strokeModeRef={strokeModeRef}
          onGameStart={() => { sessionStartRef.current = Date.now() }}
          interactive={phase === 'game'}
        />
      </div>

      {/* stroke selector — game phase only */}
      {phase === 'game' && (
        <StrokeSelector
          activeStroke={activeStroke}
          onSelect={handleStrokeSelect}
        />
      )}

      {/* intro overlay — intro phase only */}
      {phase === 'intro' && (
        <GameIntro
          variant={introVariant}
          onComplete={() => setPhase('game')}
        />
      )}
    </div>
  )
}
