// ── DragonGame.jsx ────────────────────────────────────────────────────────────
// SPIKE — proof of concept for Rive integration. Not production code.
// Goal: confirm Rive loads, plays, and responds to state machine inputs
// in the Whoosha React/Vite stack.
// This file will be replaced by the full DragonGame implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef } from 'react'
import { useRive } from '@rive-app/react-canvas'

// ── SPIKE CONFIG ─────────────────────────────────────────────────────────────
// Update these values to match your sample .riv file.
// Open the file in the Rive desktop editor to find the correct names.
const RIV_FILE      = '/assets/dragon-spike.riv'
const STATE_MACHINE = 'State Machine 1'  // exact name from Rive editor
// ─────────────────────────────────────────────────────────────────────────────

export default function DragonGame({ onExit }) {
  const sessionStartRef = useRef(Date.now())

  const { rive, RiveComponent } = useRive({
    src: RIV_FILE,
    stateMachines: STATE_MACHINE,
    autoplay: true,
  })

  return (
    <div className="absolute inset-0 bg-bg-eucalyptus flex flex-col items-center justify-center"
      style={{ touchAction: 'none' }}>

      {/* Back button — same style as SquareGame */}
      <button
        onClick={() => onExit?.(Math.round((Date.now() - sessionStartRef.current) / 1000))}
        className="absolute top-4 left-4 z-20 w-11 h-11 flex items-center justify-center
          rounded-2xl bg-white/15 text-white hover:bg-white/25 active:bg-white/30
          transition-colors"
        aria-label="Exit"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>

      {/* Rive canvas — fills available width up to 480px, square aspect ratio */}
      <div className="w-full px-6">
        <div className="w-full max-w-[480px] mx-auto aspect-square rounded-2xl overflow-hidden bg-white/10">
          <RiveComponent />
        </div>
      </div>

      {/* Spike label */}
      <p className="mt-6 text-white/50 text-sm font-body">
        Rive Spike — state machine: <span className="text-white/80">{STATE_MACHINE}</span>
      </p>

    </div>
  )
}
