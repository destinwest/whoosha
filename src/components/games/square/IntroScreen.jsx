import { useRef, useEffect } from 'react'

// ── Timing (ms) ───────────────────────────────────────────────────────────────
const TEXT_MS   = 4_000   // Phase 1: text, static bg
const INHALE_MS = 4_000   // Phase 2: background brightens to mint
const EXHALE_MS = 4_000   // Phase 3: background dims to game color
const FADE_MS   =   500   // Handoff: component fades to transparent
const TOTAL_MS  = TEXT_MS + INHALE_MS + EXHALE_MS

// ── Colors ────────────────────────────────────────────────────────────────────
const DARK_FOREST = '#2C4A3E'  // Phase 1 bg (static)
const INHALE_MINT = '#D4EBE0'  // Inhale peak color
const GAME_BG     = '#9FBFB4'  // Exhale settles here — matches game canvas exactly
const TEXT_COLOR  = '#F5F0E8'  // Warm white for both lines
const SKIP_COLOR  = '#6D9B8A'  // Sage — low contrast, unobtrusive

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

const RGB_INHALE_MINT = hexToRgb(INHALE_MINT)
const RGB_GAME_BG     = hexToRgb(GAME_BG)

function lerpRgb([r1, g1, b1], [r2, g2, b2], t) {
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`
}

// ── IntroScreen ───────────────────────────────────────────────────────────────
// Full-screen pre-game breath sequence. All timing driven by performance.now()
// + requestAnimationFrame — no CSS transitions, no setTimeout.
//
// Sequence:
//   0–4s    Static dark forest bg. Line 1 visible. Line 2 fades in.
//   4–8s    Radial gradient expands from center: dark forest → luminous mint.
//   8–12s   Flat lerp: luminous mint → #9FBFB4 (game canvas bg). Seamless handoff.
//   12–12.5s Component fades opacity 1 → 0, then calls onComplete().
//
// Props:
//   onComplete() — called when sequence ends or skip is tapped.
export default function IntroScreen({ onComplete }) {
  const containerRef = useRef(null)
  const line2Ref     = useRef(null)
  const rafRef       = useRef(null)
  const startRef     = useRef(null)
  const doneRef      = useRef(false)

  function finish() {
    if (doneRef.current) return
    doneRef.current = true
    cancelAnimationFrame(rafRef.current)
    onComplete()
  }

  useEffect(() => {
    startRef.current = performance.now()

    function frame() {
      const el  = containerRef.current
      const ln2 = line2Ref.current
      if (!el || !ln2) return

      const elapsed = performance.now() - startRef.current

      if (elapsed < TEXT_MS) {
        // ── Phase 1: Text ──────────────────────────────────────────────────
        // Bg stays static. Line 2 opacity interpolates 0 → 1 over 4000ms.
        el.style.background = DARK_FOREST
        el.style.opacity    = '1'
        ln2.style.opacity   = String(elapsed / TEXT_MS)

      } else if (elapsed < TEXT_MS + INHALE_MS) {
        // ── Phase 2: Inhale ────────────────────────────────────────────────
        // Radial gradient disc expands from 0% to 150% radius.
        // Hard edge disc (r%, r%) creates a clear expanding circle of mint.
        const t = (elapsed - TEXT_MS) / INHALE_MS
        const r = (t * 150).toFixed(1)
        el.style.background = `radial-gradient(circle at center, ${INHALE_MINT} ${r}%, ${DARK_FOREST} ${r}%)`
        el.style.opacity    = '1'
        ln2.style.opacity   = '1'

      } else if (elapsed < TOTAL_MS) {
        // ── Phase 3: Exhale ────────────────────────────────────────────────
        // Flat lerp from mint to game bg. At t=1 the color exactly matches
        // the game canvas so there is no seam when this layer disappears.
        const t = (elapsed - TEXT_MS - INHALE_MS) / EXHALE_MS
        el.style.background = lerpRgb(RGB_INHALE_MINT, RGB_GAME_BG, t)
        el.style.opacity    = '1'
        ln2.style.opacity   = '1'

      } else if (elapsed < TOTAL_MS + FADE_MS) {
        // ── Handoff: fade out ──────────────────────────────────────────────
        const t = (elapsed - TOTAL_MS) / FADE_MS
        el.style.background = GAME_BG
        el.style.opacity    = String(1 - t)

      } else {
        finish()
        return
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col items-center justify-center select-none"
      style={{ background: DARK_FOREST }}
    >
      {/* Line 1 — visible immediately at full opacity */}
      <p
        className="font-body font-semibold text-3xl sm:text-4xl text-center px-8 leading-snug"
        style={{ color: TEXT_COLOR }}
      >
        Before we begin...
      </p>

      {/* Line 2 — opacity driven by rAF from 0 → 1 over first 4 seconds */}
      <p
        ref={line2Ref}
        className="font-body font-semibold text-3xl sm:text-4xl text-center px-8 mt-4 leading-snug"
        style={{ color: TEXT_COLOR, opacity: 0 }}
      >
        Let's take one slow breath together 🌿
      </p>

      {/* Skip — low contrast, always visible, bottom right */}
      <button
        onClick={finish}
        className="absolute bottom-6 right-6 font-body text-sm"
        style={{ color: SKIP_COLOR }}
        aria-label="Skip intro"
      >
        skip
      </button>
    </div>
  )
}
