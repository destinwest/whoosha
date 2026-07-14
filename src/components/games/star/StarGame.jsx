import { useState, useRef, useEffect } from 'react'
import StrokeSelector from '../square/StrokeSelector'   // shared until refactor
import StarCanvas from './StarCanvas'
import CompletionScreen from '../square/CompletionScreen'
import MuteButton from '../../ui/MuteButton'
import { useStarVoice } from '../../../hooks/useStarVoice'

// Mirrors the flag in SquareGame.jsx — see comment there. The games share the
// StrokeSelector component, but each toggles its visibility independently.
const STROKE_SELECTOR_ENABLED = false

// Game canvas opacity once completion phase begins — the world recedes
// behind the completion card without vanishing entirely (matches Infinity).
const COMPLETION_CANVAS_OPACITY = 0.25

// ── Morning's-first-light background ─────────────────────────────────────────
// Soft sunrise gradient after the user's reference photo: light white-yellow at
// the top, through a soft peach/pink glow and dusty lavender, to light blue at
// the bottom. Softened toward the reference's low saturation while staying in
// the same hue family as the paint palette (StarCanvas LAP_COLORS).
const SKY_STOPS = [
  [0.00, '#FCF6DB'],   // light white-yellow (top)
  [0.30, '#FBDAD6'],   // soft peach / pink glow
  [0.55, '#ECD5E4'],   // pink-lavender
  [0.78, '#CFD2EE'],   // lavender-blue
  [1.00, '#A7C2F7'],   // light blue (bottom)
]
const BG_SOLID = '#ECD5E4'   // flat fallback behind the canvas (mid sky tone)

// ── buildMorningBg ──────────────────────────────────────────────────────────
// A single baked vertical gradient, baked once per resize so per-frame cost is
// zero — same baked-bitmap pattern as the other games.
function buildMorningBg(w, h, dpr) {
  const oc = document.createElement('canvas')
  oc.width  = w * dpr
  oc.height = h * dpr
  const ctx = oc.getContext('2d')
  ctx.scale(dpr, dpr)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  for (const [stop, color] of SKY_STOPS) sky.addColorStop(stop, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  return oc
}

// ── StarGame ──────────────────────────────────────────────────────────────────
// Phase manager — owns game phase, stroke selection, session timing, exit, the
// baked (placeholder) morning background, and the voice cues. All canvas
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
  // do) and fires one voice cue per transition, every 5s — mirrors
  // HexagonCanvas's onBreath shape, but this consumer is event-driven (a
  // one-shot clip per phase change) rather than continuous synth modulation.
  // Called UNCONDITIONALLY every frame from mount, same as Hexagon's — no
  // startedRef gate (see StarCanvas's onBreath call site for why an earlier
  // version had one, and why it was wrong).
  //
  // Phase parity: pacingArcOrigin anchors the dot at the TOP TIP at mount, so
  // its first full segment (phase 0) is a DESCENT — "out", not "in". Even
  // phases are out, odd are in (the reverse of the pre-2026-07-14 mapping,
  // which matched the old valley-anchored origin).
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
    const played = voiceRef.current?.play(phaseIdx % 2 === 0 ? 'out' : 'in')
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
  // emitBreath (in/out, above) follows the exact same shape — mount-anchored,
  // unconditional, audible on first unlock, whichever path provided it — so
  // intro and the breath cues behave consistently; no more gating divergence
  // between them. Sequencing intro against the first breath cue is still not
  // explicitly orchestrated (no delay/handoff between them) — they can
  // overlap in time, though in practice the dot's phase-0 (out, ending at the
  // first valley) is what's live for most of the intro's ~5.4s run, so the
  // ordinary case reads as: intro, then a descent to the valley, then
  // "breathe out."
  const emitTick = useRef(() => {
    if (introPlayedRef.current || phaseRef.current !== 'game') return
    const played = voiceRef.current?.play('intro')
    if (played) introPlayedRef.current = true
  }).current

  // ── Morning background — baked once per resize ──────────────────────────────
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
      el.getContext('2d').drawImage(buildMorningBg(w, h, dpr), 0, 0)
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
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center rounded-2xl bg-slate-600/15 text-slate-600 hover:bg-slate-600/25 active:bg-slate-600/30 transition-colors"
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
          {/* Morning background — baked at resize (placeholder gradient for now) */}
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

      {/* Vignette — a gentle cool lavender darkening at the edges (light, so the
          pale morning sky doesn't turn muddy). */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(120,116,168,0.16) 100%)',
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
