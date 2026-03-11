import { useState, useEffect, useRef } from 'react'

// ── Static styles injected once ───────────────────────────────────────────────
const INJECTED_STYLE = `
  @keyframes stroke-panel-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  .stroke-icon-btn:hover, .stroke-icon-btn:active {
    background: rgba(44,74,62,0.90) !important;
  }
`

// ── Stroke options ─────────────────────────────────────────────────────────────
const STROKES = [
  { id: 'classic',    label: 'Classic'    },
  { id: 'watercolor', label: 'Watercolor' },
]

// ── Paintbrush icon ───────────────────────────────────────────────────────────
// Simple handle line + bristle tip, ~20×20 viewBox.
function PaintbrushIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {/* Handle */}
      <line x1="15" y1="3" x2="9" y2="9"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      {/* Brush head — widens toward the bristle end */}
      <path d="M9 9 C7 7 3.5 8 3.5 11.5 C3.5 14 6.5 15 9 13 Z"
        fill="currentColor"/>
      {/* Bristle tip */}
      <path d="M3.5 12 Q2 15.5 3 18 Q5.5 17 6 14"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    </svg>
  )
}

// ── StrokeSelector ────────────────────────────────────────────────────────────
// Purely presentational — all stroke state lives in the parent.
//
// Props:
//   activeStroke — 'classic' | 'watercolor'
//   onSelect(id) — called when user picks a stroke; parent updates activeStroke
export default function StrokeSelector({ activeStroke, onSelect }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Close panel on outside tap — listener active only while panel is open.
  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [open])

  function choose(id) {
    onSelect(id)
    setOpen(false)
  }

  return (
    <>
      <style>{INJECTED_STYLE}</style>

      <div
        ref={rootRef}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 20 }}
      >
        {/* Icon button */}
        <button
          className="stroke-icon-btn"
          onClick={() => setOpen(o => !o)}
          aria-label="Select stroke style"
          aria-expanded={open}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: 'rgba(44,74,62,0.70)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.88)',
            transition: 'background 100ms',
            padding: 0,
          }}
        >
          <PaintbrushIcon />
        </button>

        {/* Floating panel */}
        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: 148,
              background: 'rgba(44,74,62,0.85)',
              borderRadius: 12,
              overflow: 'hidden',
              animation: 'stroke-panel-in 120ms ease forwards',
            }}
          >
            {STROKES.map(({ id, label }) => {
              const active = activeStroke === id
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={() => choose(id)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && choose(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 44,
                    padding: '0 16px',
                    background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: "'Nunito', sans-serif",
                    fontWeight: 600,
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.88)',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Selection indicator dot */}
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: active ? 'rgba(255,255,255,0.80)' : 'transparent',
                    border: active ? 'none' : '1.5px solid rgba(255,255,255,0.25)',
                    boxSizing: 'border-box',
                  }} />
                  {label}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
