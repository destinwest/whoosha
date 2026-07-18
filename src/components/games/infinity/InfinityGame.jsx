import { useState, useRef, useEffect } from 'react'
import InfinityCanvas   from './InfinityCanvas'
import CompletionScreen from '../square/CompletionScreen'
import { buildLakeSurfaceBg } from './lakeSurface'

// Game canvas opacity once completion phase begins — the world recedes behind
// the completion card without vanishing entirely.
const COMPLETION_CANVAS_OPACITY = 0.25

// Label screen slot 0 (top-lobe position) always shows the breathe in/out text;
// slot 1 (bottom-lobe position) always shows the countdown. Which physical lobe
// the pacing circle is tracing at any moment is independent of this — see
// InfinityCanvas's getPacing.
const PHASE_TEXT = { in: 'breathe in', out: 'breathe out' }

// ── InfinityGame ──────────────────────────────────────────────────────────────
// Phase manager — owns intro/game/completion phase, session timing, exit, and the
// baked lake-surface background (an abstract Rocky Mountain lake — see
// lakeSurface.js; replaced the night sky 2026-07-14). All canvas drawing +
// geometry live in InfinityCanvas.
export default function InfinityGame({ onExit }) {
  const [phase, setPhase]                         = useState('game')  // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [labelGeo, setLabelGeo]                   = useState(null)    // { labelMids, size }
  const [breathLabel, setBreathLabel]             = useState('in')    // 'in' | 'out'
  const [breathSecondsLeft, setBreathSecondsLeft] = useState(4)

  const sessionStartRef = useRef(null)
  const infinityCanvasRef = useRef(null)
  const bgCanvasRef       = useRef(null)
  const pacingCanvasRef   = useRef(null)
  const breathLabelRef       = useRef('in')
  const breathSecondsLeftRef = useRef(4)

  // Per-rAF-frame tick from InfinityCanvas — only re-render when the displayed
  // breath label or countdown second actually changes, not on every frame.
  function handleGameStateTick(state) {
    if (state.breathLabel !== breathLabelRef.current) {
      breathLabelRef.current = state.breathLabel
      setBreathLabel(state.breathLabel)
    }
    if (state.breathSecondsLeft !== breathSecondsLeftRef.current) {
      breathSecondsLeftRef.current = state.breathSecondsLeft
      setBreathSecondsLeft(state.breathSecondsLeft)
    }
  }

  // ── Lake-surface background — baked once per resize ─────────────────────────
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
      el.getContext('2d').drawImage(buildLakeSurfaceBg(w, h, dpr), 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    <div className="absolute inset-0 overflow-hidden select-none" style={{ touchAction: 'none', background: '#0656AB' }}>
      {/* Top chrome */}
      <div style={{ opacity: 'var(--intro-ui, 1)' }}>
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
      </div>

      {/* The world */}
      <div style={{
        position: 'absolute', inset: 0, background: '#0656AB',
        opacity: phase === 'completion' ? COMPLETION_CANVAS_OPACITY : 1,
        transition: phase === 'completion' ? 'opacity 1800ms ease' : undefined,
      }}>
        {/* Lake surface — baked; desaturates with the heat gauge */}
        <div style={{
          position: 'absolute', inset: 0,
          filter: 'saturate(var(--game-saturation, 1))',
          willChange: 'filter',
        }}>
          <canvas ref={bgCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>

        {/* Foreground — the breathing figure-8 */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {/* Saturation wrapper — track desaturates in lockstep with the sky */}
          <div style={{
            position: 'absolute', inset: 0,
            filter: 'saturate(var(--game-saturation, 1))',
            willChange: 'filter',
          }}>
            <InfinityCanvas
              ref={infinityCanvasRef}
              pacingCanvasRef={pacingCanvasRef}
              onGameStart={() => { sessionStartRef.current = Date.now() }}
              onGameStateTick={handleGameStateTick}
              onResize={setLabelGeo}
              interactive={phase === 'game'}
            />
          </div>

          {/* Pacing-circle layer — above the saturate wrapper so it stays vivid */}
          <canvas
            ref={pacingCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />

          {/* Labels — DOM text at each lobe's screen slot. Top slot: breathe
              in/out text, toggles once per phase. Bottom slot: countdown
              number, ticks every second. */}
          {labelGeo && (() => {
            const fs = Math.max(13, labelGeo.size * 0.045)
            const items = [PHASE_TEXT[breathLabel], String(breathSecondsLeft)]
            return (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {items.map((text, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: labelGeo.labelMids[i].x,
                      top:  labelGeo.labelMids[i].y,
                      transform: 'translate(-50%, -50%)',
                      fontFamily: "'Nunito', sans-serif",
                      fontWeight: 700,
                      fontSize: `${fs}px`,
                      color: 'rgba(228,240,252,0.85)',   // pale blue-white — legible on the deep royal water
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {text}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Vignette — the one allowed overlay. Deep-navy shading (not pure black)
          so the royal water darkens toward its own depths at the edges rather
          than toward night. */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(4,28,56,0.40) 100%)',
      }} />

      {/* Completion overlay — time shown first, then the trailing phrase, per
          user-preference-testing variant. */}
      {phase === 'completion' && (
        <CompletionScreen
          durationSeconds={completionSeconds}
          onDismiss={handleCompletionDismiss}
          leadText=""
          trailText="of connecting your body and mind"
        />
      )}
    </div>
  )
}
