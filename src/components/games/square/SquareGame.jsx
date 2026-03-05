import { useRef, useEffect } from 'react'

// ── Palette ───────────────────────────────────────────────────────────────────
const SIDE_COLORS = ['#B5DC84', '#7CC87A', '#5A9E6A', '#2A8E82']

const MESSAGES = [
  'Beautiful work 🌟',
  "You're doing great 🌊",
  'Keep breathing 🌿',
  'So peaceful ✨',
]

const CYCLE_MS       = 16_000
const GOOD_THRESHOLD = 0.3

// ── SquareGame ────────────────────────────────────────────────────────────────
// Reusable game canvas component. Renders as `absolute inset-0` so the parent
// controls sizing. Uses `fixed inset-0` on the parent for full-screen play.
//
// Props:
//   onExit(durationSeconds) — called when the back button is pressed.
//     The parent handles navigation and any session persistence.

export default function SquareGame({ onExit }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const geoRef    = useRef(null)

  const startedRef      = useRef(false)
  const gameStartRef    = useRef(null)
  const sessionStartRef = useRef(Date.now())
  const childPosRef     = useRef(null)
  const touchRef        = useRef(false)
  const trailRef        = useRef([])
  const pulseRef        = useRef(0)

  const cycleIdxRef = useRef(-1)
  const devsRef     = useRef([])
  const prevGoodRef = useRef(false)
  const goodCntRef  = useRef(0)

  const msgRef      = useRef(null)
  const msgTimerRef = useRef(null)

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
        { x: cx - half, y: cy + half }, // 0: BL
        { x: cx + half, y: cy + half }, // 1: BR
        { x: cx + half, y: cy - half }, // 2: TR
        { x: cx - half, y: cy - half }, // 3: TL
      ],
      cx, cy, sq, lw,
    }
  }

  // ── Path helpers ──────────────────────────────────────────────────────────
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

  // ── Message ───────────────────────────────────────────────────────────────
  function triggerMsg(text) {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    msgRef.current = text
    msgTimerRef.current = setTimeout(() => { msgRef.current = null }, 3000)
  }

  // ── Exit ──────────────────────────────────────────────────────────────────
  function handleExit() {
    cancelAnimationFrame(rafRef.current)
    const dur = Math.round((Date.now() - sessionStartRef.current) / 1000)
    onExit(dur)
  }

  // ── Pointer helpers ───────────────────────────────────────────────────────
  function getRawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function onPointerDown(px, py) {
    const geo = geoRef.current
    if (!geo) return
    if (!startedRef.current) {
      const BL   = geo.corners[0]
      const dist = Math.hypot(px - BL.x, py - BL.y)
      if (dist <= geo.lw * 2.5) {
        startedRef.current   = true
        gameStartRef.current = performance.now()
        touchRef.current     = true
        const pos = project(px, py)
        childPosRef.current  = pos
        trailRef.current     = [{ x: pos.x, y: pos.y, t: performance.now() }]
      }
    } else {
      touchRef.current = true
      const pos = project(px, py)
      childPosRef.current = pos
      trailRef.current.push({ x: pos.x, y: pos.y, t: performance.now() })
    }
  }

  function onPointerMove(px, py) {
    if (!startedRef.current || !touchRef.current) return
    const pos = project(px, py)
    childPosRef.current = pos
    trailRef.current.push({ x: pos.x, y: pos.y, t: performance.now() })
  }

  function onPointerUp() { touchRef.current = false }

  function handleMouseDown(e)  { const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleMouseMove(e)  { const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleMouseUp()     { onPointerUp() }
  function handleTouchStart(e) { e.preventDefault(); const p = getRawPos(e); onPointerDown(p.x, p.y) }
  function handleTouchMove(e)  { e.preventDefault(); const p = getRawPos(e); onPointerMove(p.x, p.y) }
  function handleTouchEnd(e)   { e.preventDefault(); onPointerUp() }

  // ── Main effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    function resize() {
      const dpr  = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr
      geoRef.current = buildGeo(rect)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function frame() {
      rafRef.current = requestAnimationFrame(frame)
      const geo = geoRef.current
      if (!geo) return

      const dpr = window.devicePixelRatio || 1
      const W   = canvas.width  / dpr
      const H   = canvas.height / dpr
      const { corners, cx, cy, lw } = geo

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // Square sides
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = SIDE_COLORS[i]
        ctx.lineWidth   = lw
        ctx.lineCap     = 'round'
        ctx.stroke()
      }

      pulseRef.current += 0.05
      const BL = corners[0]

      if (!startedRef.current) {
        // Pulsing amber start circle
        const p1 = Math.sin(pulseRef.current)
        const p2 = Math.sin(pulseRef.current - 0.7)

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

      } else {
        const now     = performance.now()
        const elapsed = now - gameStartRef.current
        const pacing  = getPacing(elapsed)
        if (!pacing) { ctx.restore(); return }

        // Sample timing deviation for good-cycle tracking
        if (touchRef.current && childPosRef.current) {
          let delta = childPosRef.current.fraction - pacing.fraction
          if (delta >  2) delta -= 4
          if (delta < -2) delta += 4
          devsRef.current.push(Math.abs(delta) * 4)
        }

        // Evaluate at cycle boundary
        const cycIdx = Math.floor(elapsed / CYCLE_MS)
        if (cycIdx > cycleIdxRef.current) {
          const samples = devsRef.current
          const avg     = samples.length > 0
            ? samples.reduce((s, v) => s + v, 0) / samples.length
            : Infinity
          const isGood = avg <= GOOD_THRESHOLD

          if (isGood) {
            goodCntRef.current++
            const n    = goodCntRef.current
            const prev = prevGoodRef.current
            if (n === 1 || (n > 1 && (n - 1) % 5 === 0) || (!prev && isGood)) {
              triggerMsg(MESSAGES[(n - 1) % MESSAGES.length])
            }
          }

          prevGoodRef.current = isGood
          cycleIdxRef.current = cycIdx
          devsRef.current     = []
        }

        // Lavender trail
        const TRAIL_FADE_MS = 2000
        trailRef.current = trailRef.current.filter(p => now - p.t < TRAIL_FADE_MS)
        const trail = trailRef.current
        for (let i = 1; i < trail.length; i++) {
          const age = (now - trail[i].t) / TRAIL_FADE_MS
          ctx.beginPath()
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
          ctx.lineTo(trail[i].x,     trail[i].y)
          ctx.strokeStyle = `rgba(155,143,196,${((1 - age) * 0.65).toFixed(2)})`
          ctx.lineWidth   = lw * 0.45
          ctx.lineCap     = 'round'
          ctx.stroke()
        }

        // Pacing circle (white)
        ctx.beginPath()
        ctx.arc(pacing.x, pacing.y, lw * 0.62, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        ctx.fill()

        // Child trace circle (amber)
        if (touchRef.current && childPosRef.current) {
          ctx.beginPath()
          ctx.arc(childPosRef.current.x, childPosRef.current.y, lw * 0.85, 0, Math.PI * 2)
          ctx.fillStyle = '#D4A056'
          ctx.fill()
        }

        // Motivational message (centered in square)
        if (msgRef.current) {
          const fs = Math.max(18, geo.sq * 0.07)
          ctx.save()
          ctx.font         = `600 ${fs}px 'Nunito', sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle    = 'rgba(255,255,255,0.92)'
          ctx.fillText(msgRef.current, cx, cy)
          ctx.restore()
        }
      }

      ctx.restore()
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    }
  }, [])

  return (
    <div
      className="absolute inset-0 bg-bg-eucalyptus overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <button
        onClick={handleExit}
        className="absolute top-4 left-4 z-10 w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30 transition-colors"
        aria-label="Exit game"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
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
