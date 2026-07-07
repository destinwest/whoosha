import { useState, useRef, useEffect } from 'react'
import InfinityCanvas   from './InfinityCanvas'
import CompletionScreen from '../square/CompletionScreen'
import { buildNightSkyBg } from './nightSky'

// Game canvas opacity once completion phase begins — the world recedes behind
// the completion card without vanishing entirely.
const COMPLETION_CANVAS_OPACITY = 0.25

// Two-phase lazy-8 breath: top lobe = inhale, bottom lobe = exhale.
const LABEL_TEXTS = ['breathe in', 'breathe out']

// ── InfinityGame ──────────────────────────────────────────────────────────────
// Phase manager — owns intro/game/completion phase, session timing, exit, and the
// baked night-sky background. All canvas drawing + geometry live in InfinityCanvas.
export default function InfinityGame({ onExit }) {
  const [phase, setPhase]                         = useState('game')  // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [labelGeo, setLabelGeo]                   = useState(null)    // { labelMids, size }

  const sessionStartRef = useRef(null)
  const infinityCanvasRef = useRef(null)
  const bgCanvasRef       = useRef(null)
  const pacingCanvasRef   = useRef(null)

  // ── Night-sky background — baked once per resize ────────────────────────────
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
      el.getContext('2d').drawImage(buildNightSkyBg(w, h, dpr), 0, 0)
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
    <div className="absolute inset-0 overflow-hidden select-none" style={{ touchAction: 'none', background: '#070A22' }}>
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
        position: 'absolute', inset: 0, background: '#070A22',
        opacity: phase === 'completion' ? COMPLETION_CANVAS_OPACITY : 1,
        transition: phase === 'completion' ? 'opacity 1800ms ease' : undefined,
      }}>
        {/* Night sky — baked; desaturates with the heat gauge */}
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
              onResize={setLabelGeo}
              interactive={phase === 'game'}
            />
          </div>

          {/* Pacing-circle layer — above the saturate wrapper so it stays vivid */}
          <canvas
            ref={pacingCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />

          {/* Labels — DOM text at each lobe's center (static for now) */}
          {labelGeo && (() => {
            const fs = Math.max(13, labelGeo.size * 0.045)
            return (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {LABEL_TEXTS.map((text, i) => (
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
                      color: 'rgba(232,227,248,0.82)',
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

      {/* Vignette — the one allowed overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%)',
      }} />

      {/* Completion overlay */}
      {phase === 'completion' && (
        <CompletionScreen durationSeconds={completionSeconds} onDismiss={handleCompletionDismiss} />
      )}
    </div>
  )
}
