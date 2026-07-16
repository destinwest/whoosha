import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import StarCanvas from './StarCanvas'
import CompletionScreen from '../square/CompletionScreen'
import MuteButton from '../../ui/MuteButton'
import { useStarVoice } from '../../../hooks/useStarVoice'
import { buildNightSkyBg } from '../_shared/nightSky'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── Night-sky background ─────────────────────────────────────────────────────
// The same starry night as the Infinity game — buildNightSkyBg from
// _shared/nightSky.js (fixed seed, so the two games' skies are pixel-identical).
// Replaced the earlier morning's-first-light gradient entirely (user request,
// 2026-07-14). Baked once per resize; per-frame cost zero.
const BG_SOLID = '#070A22'   // flat fallback behind the canvas (sky's darkest tone — matches Infinity)

// ── StarGame ──────────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, the
// baked night-sky background, and the voice cues. All canvas
// drawing, geometry, and pointer handling live in StarCanvas.
//
// No on-screen breathing labels — voice-only instruction (spoken "breathe in" /
// "breathe out" cues via useStarVoice), testing whether voice-only reads better
// than text for this game. The star's 10 arms made the old text labels feel
// cramped regardless of layout tuning; removed rather than fought.
//
// A one-shot spoken intro ("StarGameBreathIntro.mp3") also plays once at game
// open, ahead of the first breath cue — see emitTick below. This is the one
// piece of Star's audio design that's deliberately different from every other
// game (none of which have an intro clip).
export default function StarGame({ onExit }) {

  // Mount straight into play — no in-game intro (same as Hexagon / Infinity /
  // Triangle).
  const [phase, setPhase]               = useState('game')   // 'game' | 'completion'
  const [completionSeconds, setCompletionSeconds] = useState(0)
  const [activeStroke, setActiveStroke] = useState('classic')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionStartRef  = useRef(null)
  const strokeModeRef    = useRef('classic')
  const starCanvasRef    = useRef(null)
  const bgCanvasRef      = useRef(null)
  const pacingCanvasRef  = useRef(null)  // sibling above saturate wrapper — pacing circle bypasses desaturation

  // ── Voice cues ───────────────────────────────────────────────────────────
  // Minimal, non-SoundDirector audio path (mirrors Hexagon's useHexBreath) —
  // just the two spoken clips, no ambient bed. `phaseRef` mirrors `phase` into
  // a ref so the STABLE `emitBreath` callback (identity fixed via useRef, so
  // StarCanvas doesn't get a new prop every render) can gate on the latest
  // phase without going stale — `emitBreath` is created once, so closing over
  // `phase` directly would freeze it at its first-render value.
  const voiceRef   = useStarVoice()
  const phaseRef   = useRef(phase)
  phaseRef.current = phase

  const lastBreathPhaseRef = useRef(-1)
  // Edge-detects breath-phase transitions from StarCanvas's per-frame, TIME-
  // based fraction [0, 10), counted from MOUNT (evenly spaced — see the
  // onBreath call site in StarCanvas for why a plain geometric fraction won't
  // do) and fires one voice cue per transition, every 4s — mirrors
  // HexagonCanvas's onBreath shape, but this consumer is event-driven (a
  // one-shot clip per phase change) rather than continuous synth modulation.
  // Called UNCONDITIONALLY every frame from mount, same as Hexagon's — no
  // startedRef gate of its OWN (see StarCanvas's onBreath call site for why
  // an earlier version had one, and why it was wrong). Since 2026-07-15,
  // StarCanvas's caller does skip calling this for the first
  // PACING_START_DELAY_MS (a fixed time gate, not a touch/tracing gate — see
  // that call site for why the distinction matters) so the pacing dot can sit
  // still through the spoken intro; from this function's own point of view
  // nothing changed, it still just reacts to whatever fraction it's handed.
  //
  // Phase parity: pacingArcOrigin anchors the dot at the BOTTOM TROUGH (V6,
  // between the star's two lowest tips) at mount, so its first full segment
  // (phase 0) is an ASCENT — "in", not "out". Even phases are in, odd are out
  // (2026-07-15 user request — reverts the 2026-07-14 mapping, which matched
  // the old top-tip-anchored origin; matches the ORIGINAL pre-2026-07-11
  // mapping, back from when the origin was also valley-anchored).
  //
  // lastBreathPhaseRef only advances when play() reports it actually started
  // (see useStarVoice) — if the AudioContext's resume() from unlock() hasn't
  // resolved yet on this exact frame (a possible few-ms gap right at
  // unlock), the SAME phaseIdx is retried on the next frame instead of the
  // cue being silently lost until the next phase boundary.
  const emitBreath = useRef((fraction) => {
    if (phaseRef.current !== 'game') return   // no new cues once completion begins
    const phaseIdx = Math.floor(fraction)
    if (phaseIdx === lastBreathPhaseRef.current) return
    const played = voiceRef.current?.play(phaseIdx % 2 === 0 ? 'in' : 'out')
    if (played) lastBreathPhaseRef.current = phaseIdx
  }).current
  const unlockAudio = useRef(() => voiceRef.current?.unlock()).current

  const introPlayedRef = useRef(false)
  // Reset the intro flag whenever the voice-session effect tears down.
  // StrictMode's dev-only mount→cleanup→remount would otherwise let the
  // FIRST, instantly-disposed voice instance claim the intro (play() succeeds
  // for a few ms, then dispose silences it) and the surviving instance would
  // never replay it. In production this cleanup only runs at real unmount.
  // (Genuinely true as of 2026-07-13: useStarVoice runs on the app's shared
  // AudioContext — see sharedContext.js — unlocked synchronously by the home
  // carousel's card-tap handler, so it's typically ALREADY 'running' by the
  // time this component mounts. A note here briefly, incorrectly claimed this
  // wasn't true — corrected 2026-07-14 after re-checking against sharedContext.js
  // and GameCarousel.jsx directly, not just this file's own unlockAudio, which
  // is a real but now-secondary fallback for direct URL loads that skip the
  // carousel entirely — see its own comment below.)
  useEffect(() => () => { introPlayedRef.current = false }, [])
  // Plays the intro clip once, as early as technically possible — "the
  // opening of the game" (mount) — a one-shot scene-setter, not a repeating
  // breath cue. Retried every frame via onTick until play() reports success.
  // In the normal flow (home → tap a card → game) the shared AudioContext is
  // typically already running by mount (see the note above), so this is
  // usually audible within a frame or two of mount, no touch required. The
  // retry only matters for the fallback path — a direct URL load, where
  // unlockAudio (this component's own onPointerDown, below) is what
  // eventually flips the context to 'running'.
  //
  // emitBreath (in/out, above) is mount-anchored the same way, but — since
  // 2026-07-15 — its caller (StarCanvas) deliberately withholds it for
  // PACING_START_DELAY_MS (5.5s) so it can't fire while this intro clip is
  // still playing; see the onBreath call site in StarCanvas for the
  // mechanism. So intro-vs-first-cue sequencing IS now explicitly
  // orchestrated (this was an open follow-up through 2026-07-15, resolved by
  // that change): intro starts at mount, the pacing dot sits still at the
  // bottom trough until the intro's had time to finish, then the dot starts
  // its first full segment — an ASCENT toward a tip — landing exactly as
  // "breathe in" fires. Ordinary case reads as: intro, then a beat of
  // stillness, then the dot climbs to a tip as "breathe in" plays.
  const emitTick = useRef(() => {
    if (introPlayedRef.current || phaseRef.current !== 'game') return
    const played = voiceRef.current?.play('intro')
    if (played) introPlayedRef.current = true
  }).current

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

  // ── Stroke selection ────────────────────────────────────────────────────────
  function handleStrokeSelect(newStroke) {
    if (newStroke === strokeModeRef.current) return
    strokeModeRef.current = newStroke
    setActiveStroke(newStroke)
    starCanvasRef.current?.reset()
  }

  // ── Exit → completion → dismiss ─────────────────────────────────────────────
  function handleExit() {
    if (phase === 'completion') { handleCompletionDismiss(); return }
    document.documentElement.style.setProperty('--game-saturation', '1')
    const dur = Math.round((Date.now() - (sessionStartRef.current ?? Date.now())) / 1000)
    setCompletionSeconds(dur)
    setPhase('completion')
    voiceRef.current?.stop()   // silence any in-flight cue rather than let it linger under the card
  }
  function handleCompletionDismiss() { onExit(completionSeconds) }

  return (
    <div
      className="absolute inset-0 overflow-hidden select-none"
      style={{ touchAction: 'none', background: BG_SOLID }}
      onPointerDown={unlockAudio}   // fallback unlock (iOS) for direct URL loads that skipped the carousel's card-tap unlock — see the note above introPlayedRef
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

      <MuteButton className="absolute top-4 right-4 z-20" />

      {/* game canvas — always mounted; blur/scale driven by CSS custom properties.
          Dims (doesn't vanish) once completion phase begins, same treatment as
          Infinity's world wrapper. */}
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'blur(var(--intro-blur, 0px))',
        transform: 'translateY(var(--intro-y, 0px)) scale(var(--intro-scale, 1))',
        transformOrigin: 'center center',
        willChange: 'transform, filter',
        opacity: phase === 'completion' ? COMPLETION_CANVAS_OPACITY : 1,
        transition: phase === 'completion' ? 'opacity 1800ms ease' : undefined,
      }}>
        {/* Saturation wrapper — bg canvas and game canvas share one filter so
            the heat gauge desaturates the entire world in lockstep. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          filter: 'saturate(var(--game-saturation, 1))',
          willChange: 'filter',
        }}>
          {/* Night-sky background — baked at resize (shared with Infinity) */}
          <canvas
            ref={bgCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          <StarCanvas
            ref={starCanvasRef}
            strokeModeRef={strokeModeRef}
            pacingCanvasRef={pacingCanvasRef}
            onGameStart={() => { sessionStartRef.current = Date.now() }}
            onTick={emitTick}
            onBreath={emitBreath}
            interactive={phase === 'game'}
          />
        </div>

        {/* Pacing-circle layer — sits ABOVE the saturate wrapper so the circle
            (and its grown/glowing state at the heat-gauge floor) stays vivid
            while the rest of the world desaturates. Inside the blur wrapper so
            it still blurs with the scene during the intro. */}
        <canvas
          ref={pacingCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      </div>

      {/* Vignette — deep darkening at the edges, matching Infinity's treatment
          of the same night sky. */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
        zIndex: 15,
      }} />

      {/* stroke selector — game phase only. Currently disabled. */}
      {STROKE_SELECTOR_ENABLED && phase === 'game' && (
        <StrokeSelector
          activeStroke={activeStroke}
          onSelect={handleStrokeSelect}
        />
      )}

      {/* completion overlay — no time shown, per user-preference-testing variant. */}
      {phase === 'completion' && (
        <CompletionScreen
          durationSeconds={completionSeconds}
          onDismiss={handleCompletionDismiss}
          showTime={false}
          message="how did that feel?"
        />
      )}
    </div>
  )
}
