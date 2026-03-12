import { useState, useRef } from 'react'
import IntroScreen    from './IntroScreen'
import StrokeSelector from './StrokeSelector'
import SquareCanvas   from './SquareCanvas'

// ── Intro timeline (ms) ───────────────────────────────────────────────────────
const INTRO_TEXT_MS   = 4_000
const INTRO_FLOOD_MS  = 4_000
const INTRO_RECEDE_MS = 4_000
const INTRO_FADE_MS   =   500
const INTRO_TOTAL_MS  = INTRO_TEXT_MS + INTRO_FLOOD_MS + INTRO_RECEDE_MS

const smoothstep = t => t * t * (3 - 2 * t)

// ── SquareGame ────────────────────────────────────────────────────────────────
// Phase manager — owns intro state, stroke selection, session timing, and exit.
// All canvas drawing, game geometry, and pointer handling live in SquareCanvas.
export default function SquareGame({ onExit }) {

  // ── Phase & overlay ────────────────────────────────────────────────────────
  const [showIntro, setShowIntro]           = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(1)
  const [overlayColor, setOverlayColor]     = useState('#2C4A3E')
  const [activeStroke, setActiveStroke]     = useState('classic')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const introStartRef   = useRef(null)
  const introDoneRef    = useRef(false)
  const textRef         = useRef(null)
  const line1Ref        = useRef(null)
  const line2Ref        = useRef(null)
  const sessionStartRef = useRef(null)
  const strokeModeRef   = useRef('classic')
  const squareCanvasRef = useRef(null)

  // ── Intro timeline ─────────────────────────────────────────────────────────
  // Called each rAF frame by SquareCanvas via the onTick prop.
  function tickIntro(now) {
    if (introDoneRef.current) return
    if (!introStartRef.current) introStartRef.current = now
    const elapsed = now - introStartRef.current

    if (line1Ref.current) {
      line1Ref.current.style.opacity = Math.min(1, Math.max(0, elapsed / 500))
    }
    if (line2Ref.current) {
      line2Ref.current.style.opacity = Math.min(1, Math.max(0, (elapsed - 2_000) / 2_000))
    }
    if (textRef.current) {
      const fadeStart = INTRO_TEXT_MS + INTRO_FLOOD_MS - 1_000
      textRef.current.style.opacity = elapsed < fadeStart
        ? 1
        : Math.max(0, 1 - (elapsed - fadeStart) / 1_000)
    }

    const setOverlay = (opacity, color) => {
      setOverlayOpacity(opacity)
      if (color !== undefined) setOverlayColor(color)
    }

    if (elapsed < INTRO_TEXT_MS) {
      setOverlay(1, '#2C4A3E')
    } else if (elapsed < INTRO_TEXT_MS + INTRO_FLOOD_MS) {
      const t = smoothstep((elapsed - INTRO_TEXT_MS) / INTRO_FLOOD_MS)
      const r = Math.round(44  + (245 - 44) * t)
      const g = Math.round(74  + (239 - 74) * t)
      const b = Math.round(62  + (230 - 62) * t)
      setOverlay(1, `rgb(${r},${g},${b})`)
    } else if (elapsed < INTRO_TOTAL_MS) {
      const t = smoothstep((elapsed - INTRO_TEXT_MS - INTRO_FLOOD_MS) / INTRO_RECEDE_MS)
      setOverlay(1 - t, '#F5EFE6')
    } else if (elapsed < INTRO_TOTAL_MS + INTRO_FADE_MS) {
      setOverlay(0)
    } else {
      introDoneRef.current = true
      setShowIntro(false)
    }
  }

  function skipIntro() {
    if (introDoneRef.current) return
    introDoneRef.current = true
    setShowIntro(false)
    setOverlayOpacity(0)
  }

  // ── Stroke selection ────────────────────────────────────────────────────────
  function handleStrokeSelect(newStroke) {
    if (newStroke === strokeModeRef.current) return
    strokeModeRef.current = newStroke
    setActiveStroke(newStroke)
    squareCanvasRef.current?.reset()
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    const dur = Math.round((Date.now() - sessionStartRef.current) / 1000)
    onExit(dur)
  }

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
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

      {!showIntro && (
        <StrokeSelector
          activeStroke={activeStroke}
          onSelect={handleStrokeSelect}
        />
      )}

      <SquareCanvas
        ref={squareCanvasRef}
        strokeModeRef={strokeModeRef}
        onTick={tickIntro}
        onGameStart={() => { sessionStartRef.current = Date.now() }}
        interactive={!showIntro}
      />

      {showIntro && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: overlayColor, opacity: overlayOpacity }}
        />
      )}

      {showIntro && (
        <IntroScreen
          onSkip={skipIntro}
          textRef={textRef}
          line1Ref={line1Ref}
          line2Ref={line2Ref}
        />
      )}
    </div>
  )
}
