import { useState, useRef, useEffect } from 'react'
import IntroScreen from './IntroScreen'

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_COLOR = '#F5EFE6'                                     // cream — untraced path
const LAP_COLORS = ['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7'] // lap color sequence
const CYCLE_MS   = 16_000                                        // 4s per side × 4 sides

// ── SquareGame ────────────────────────────────────────────────────────────────
// Manages 'intro' | 'game' phases. Renders IntroScreen during intro, then
// fades in the game canvas. All game animation via requestAnimationFrame.
//
// Props:
//   onExit(durationSeconds) — called when exit button is pressed.
//     Parent handles navigation and session persistence.
export default function SquareGame({ onExit }) {

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('intro')
  const phaseRef          = useRef('intro')

  function handleIntroComplete() {
    phaseRef.current        = 'game'
    sessionStartRef.current = Date.now()
    setPhase('game')
  }

  // ── Canvas / paint refs ────────────────────────────────────────────────────
  const canvasRef = useRef(null)
  const paintRef  = useRef(null)   // off-screen canvas — permanent paint history
  const rafRef    = useRef(null)
  const geoRef    = useRef(null)

  // ── Session / game timing ──────────────────────────────────────────────────
  const sessionStartRef = useRef(Date.now())  // reset to Date.now() when intro ends
  const gameStartRef    = useRef(null)         // set when child touches start circle

  // ── Input state ────────────────────────────────────────────────────────────
  const startedRef    = useRef(false)   // has child touched the start circle
  const touchRef      = useRef(false)   // is finger/mouse currently down
  const childPosRef   = useRef(null)    // current projected position
  const prevPosRef    = useRef(null)    // previous projected position (for paint segments)

  // ── Lap tracking ───────────────────────────────────────────────────────────
  const lapColorIdxRef = useRef(0)     // indexes into LAP_COLORS with modulo
  const lapHalfRef     = useRef(false) // true once child has passed fraction ≥ 2 this lap

  // ── Pacing circle (for encouragement distance check) ──────────────────────
  const pacingPosRef = useRef(null)

  // ── Encouragement ──────────────────────────────────────────────────────────
  const lastEncouragementRef = useRef(-Infinity) // -Infinity so first qualifying lap always fires
  const encouragementRef     = useRef(null)       // { startTime } when active, null otherwise

  // ── Start circle pulse ─────────────────────────────────────────────────────
  const pulseRef = useRef(0)

  // ── Geometry ──────────────────────────────────────────────────────────────
  function buildGeo(rect) {
    const w    = rect.width
    const h    = rect.height
    const sq   = Math.min(w, h) * 0.65
    const cx   = w / 2
    const cy   = h / 2
    const half = sq / 2
    const lw   = sq * 0.055
    return {
      corners: [
        { x: cx - half, y: cy + half }, // 0: BL — start point
        { x: cx + half, y: cy + half }, // 1: BR
        { x: cx + half, y: cy - half }, // 2: TR
        { x: cx - half, y: cy - half }, // 3: TL
      ],
      cx, cy, sq, half, lw,
    }
  }

  // ── Pacing circle position ─────────────────────────────────────────────────
  // Returns { x, y, fraction } where fraction is 0–4 around the path.
  function getPacing(elapsed) {
    const geo = geoRef.current
    if (!geo) return null
    const frac = ((elapsed % CYCLE_MS) / CYCLE_MS) * 4
    const seg  = Math.floor(frac) % 4
    const t    = frac % 1
    const a    = geo.corners[seg]
    const b    = geo.corners[(seg + 1) % 4]
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, fraction: frac }
  }

  // ── Project finger onto nearest point on path centerline ──────────────────
  function project(px, py) {
    const geo = geoRef.current
    if (!geo) return null
    const { corners } = geo
    let best = { dist: Infinity, x: 0, y: 0, fraction: 0 }
    for (let i = 0; i < 4; i++) {
      const a   = corners[i]
      const b   = corners[(i + 1) % 4]
      const dx  = b.x - a.x
      const dy  = b.y - a.y
      const lsq = dx * dx + dy * dy
      let t = ((px - a.x) * dx + (py - a.y) * dy) / lsq
      t = Math.max(0, Math.min(1, t))
      const nx = a.x + t * dx
      const ny = a.y + t * dy
      const d  = Math.hypot(px - nx, py - ny)
      if (d < best.dist) best = { dist: d, x: nx, y: ny, fraction: i + t }
    }
    return best
  }

  // ── Lap detection ──────────────────────────────────────────────────────────
  // Called on every pointer move. Fraction runs 0–4; start/end is BL (fraction 0/4).
  // A lap is complete when:
  //   1. The child has been past fraction 2.0 (halfway) during this lap, AND
  //   2. Their projected position is now back below fraction 0.3 (near start).
  function checkLap(pos) {
    if (!pos) return
    const frac = pos.fraction

    // Mark halfway once child traces past the midpoint
    if (!lapHalfRef.current && frac >= 2.0 && frac < 4.0) {
      lapHalfRef.current = true
    }

    // Lap complete: returned near start AND was past halfway
    if (lapHalfRef.current && frac < 0.3) {
      onLapComplete()
    }
  }

  function onLapComplete() {
    lapHalfRef.current = false
    lapColorIdxRef.current++   // next color takes effect immediately for subsequent painting

    // Encouragement check: is the child close to the pacing circle right now?
    const now    = performance.now()
    const pacing = pacingPosRef.current
    const child  = childPosRef.current
    if (pacing && child) {
      const dist = Math.hypot(child.x - pacing.x, child.y - pacing.y)
      if (dist <= 60 && now - lastEncouragementRef.current > 45_000) {
        encouragementRef.current     = { startTime: now }
        lastEncouragementRef.current = now
      }
    }
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  function handleExit() {
    cancelAnimationFrame(rafRef.current)
    const dur = Math.round((Date.now() - sessionStartRef.current) / 1000)
    onExit(dur)
  }

  // ── Paint helpers ──────────────────────────────────────────────────────────
  // Draws a single line segment on the off-screen paint canvas.
  // Segments are projected onto the path centerline so they naturally
  // stay within the stroke bounds without explicit clipping.
  function paintSegment(from, to) {
    const pCanvas = paintRef.current
    const geo     = geoRef.current
    if (!pCanvas || !geo) return
    const dpr  = window.devicePixelRatio || 1
    const pCtx = pCanvas.getContext('2d')
    pCtx.save()
    pCtx.scale(dpr, dpr)
    pCtx.beginPath()
    pCtx.moveTo(from.x, from.y)
    pCtx.lineTo(to.x, to.y)
    pCtx.strokeStyle = LAP_COLORS[lapColorIdxRef.current % LAP_COLORS.length]
    pCtx.lineWidth   = geo.lw
    pCtx.lineCap     = 'round'
    pCtx.stroke()
    pCtx.restore()
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return

    if (!startedRef.current) {
      // Only start when child touches near the BL start circle
      const BL   = geo.corners[0]
      const dist = Math.hypot(px - BL.x, py - BL.y)
      if (dist <= geo.lw * 2.5) {
        startedRef.current   = true
        gameStartRef.current = performance.now()
        touchRef.current     = true
        const pos            = project(px, py)
        childPosRef.current  = pos
        prevPosRef.current   = pos
      }
    } else {
      touchRef.current    = true
      const pos           = project(px, py)
      childPosRef.current = pos
      prevPosRef.current  = pos  // anchor paint from touch-down point
    }
  }

  function onPointerMove(px, py) {
    if (!startedRef.current || !touchRef.current) return
    const pos  = project(px, py)
    const prev = prevPosRef.current

    if (prev) paintSegment(prev, pos)

    childPosRef.current = pos
    prevPosRef.current  = pos

    checkLap(pos)
  }

  function onPointerUp() {
    touchRef.current   = false
    prevPosRef.current = null  // break paint segment — lifting finger does not erase
  }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

  // ── Main effect ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    // Off-screen paint canvas — stores all painted color permanently
    const paintCanvas = document.createElement('canvas')
    paintRef.current  = paintCanvas

    function resize() {
      const dpr  = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr
      // Resizing clears the paint canvas — acceptable on device rotation
      paintCanvas.width  = rect.width  * dpr
      paintCanvas.height = rect.height * dpr
      geoRef.current = buildGeo(rect)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function frame() {
      rafRef.current = requestAnimationFrame(frame)
      if (phaseRef.current !== 'game') return   // idle during intro

      const geo = geoRef.current
      if (!geo) return

      const dpr = window.devicePixelRatio || 1
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { corners, cx, cy, half, lw } = geo
      const now = performance.now()

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── 1. Cream base path — the untraced state ──────────────────────────
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        if (i === 0) ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.closePath()
      ctx.strokeStyle = BASE_COLOR
      ctx.lineWidth   = lw
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.stroke()

      // ── 2. Paint layer — permanent traces on top of cream ────────────────
      // paintCanvas is device-pixel sized; draw into CSS-pixel region via scale
      ctx.drawImage(paintCanvas, 0, 0, W, H)

      // ── 3. Pacing circle (white) — hidden until game starts ──────────────
      if (startedRef.current) {
        const elapsed = now - gameStartRef.current
        const pacing  = getPacing(elapsed)
        if (pacing) {
          pacingPosRef.current = pacing
          ctx.beginPath()
          ctx.arc(pacing.x, pacing.y, lw * 0.62, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.88)'
          ctx.fill()
        }
      }

      // ── 4. Child trace circle (amber) — visible while touching ───────────
      if (touchRef.current && childPosRef.current) {
        ctx.beginPath()
        ctx.arc(childPosRef.current.x, childPosRef.current.y, lw * 0.85, 0, Math.PI * 2)
        ctx.fillStyle = '#D4A056'
        ctx.fill()
      }

      // ── 5. Start circle — pulsing amber at BL, shown before game begins ──
      if (!startedRef.current) {
        pulseRef.current += 0.05
        const p1 = Math.sin(pulseRef.current)
        const p2 = Math.sin(pulseRef.current - 0.7)
        const BL = corners[0]

        ctx.beginPath()
        ctx.arc(BL.x, BL.y, lw * 1.9 + p1 * lw * 0.3, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(212,160,86,${(0.18 + p1 * 0.07).toFixed(2)})`
        ctx.lineWidth = 2.5
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(BL.x, BL.y, lw * 2.5 + p2 * lw * 0.3, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(212,160,86,${(0.1 + p2 * 0.04).toFixed(2)})`
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(BL.x, BL.y, lw * 0.85, 0, Math.PI * 2)
        ctx.fillStyle = '#D4A056'
        ctx.fill()
      }

      // ── 6. Encouragement moment ───────────────────────────────────────────
      // Fires at lap completion when child is within 60px of pacing circle
      // and at least 45 seconds have passed since the last encouragement.
      const enc = encouragementRef.current
      if (enc) {
        const t = (now - enc.startTime) / 2_000
        if (t < 1) {
          const alpha = 1 - t

          // Soft radial glow from shape center
          const glowR = half * 0.8
          const grad  = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
          grad.addColorStop(0, `rgba(212,160,86,${(alpha * 0.3).toFixed(3)})`)
          grad.addColorStop(1, 'rgba(212,160,86,0)')
          ctx.beginPath()
          ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()

          // "Beautiful work 🌟" — below the shape, fades out over 2 seconds
          const fs = Math.max(16, geo.sq * 0.065)
          ctx.save()
          ctx.font         = `600 ${fs}px 'Nunito', sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle    = `rgba(255,255,255,${(alpha * 0.92).toFixed(3)})`
          ctx.fillText('Beautiful work 🌟', cx, cy + half + fs * 1.5)
          ctx.restore()
        } else {
          encouragementRef.current = null
        }
      }

      ctx.restore()
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  const inGame = phase === 'game'

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Exit button — always visible above intro and game */}
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

      {/* Pre-game intro — fades out then calls handleIntroComplete */}
      {phase === 'intro' && (
        <IntroScreen onComplete={handleIntroComplete} />
      )}

      {/* Game canvas — opacity 0 during intro, transitions to 1 on game start */}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{
          touchAction:   'none',
          opacity:       inGame ? 1 : 0,
          transition:    'opacity 0.5s ease-in-out',
          pointerEvents: inGame ? 'auto' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      />
    </div>
  )
}
