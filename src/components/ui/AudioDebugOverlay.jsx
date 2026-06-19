// ── AudioDebugOverlay (TEMPORARY) ──────────────────────────────────────────
// On-screen readout of the SoundDirector's audio lifecycle, for diagnosing the
// iOS background/return audio bug on-device (no remote debugger needed). Shows
// the live AudioContext state + flags and a timestamped log of recent lifecycle
// events. pointer-events:none so it never blocks tracing. Remove this component
// (and the _log/_record/getDebugSnapshot instrumentation in SoundDirector, and
// the mount in SquareGame) once the bug is fixed.

import { useEffect, useState } from 'react'

function fmtTime(t) {
  const d = new Date(t)
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${mm}:${ss}.${ms}`
}

export default function AudioDebugOverlay({ directorRef }) {
  const [snap, setSnap] = useState(null)

  useEffect(() => {
    const id = setInterval(() => {
      const s = directorRef?.current?.getDebugSnapshot?.()
      if (s) setSnap({ ...s, log: [...s.log] })
    }, 250)
    return () => clearInterval(id)
  }, [directorRef])

  if (!snap) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.80)',
        color: '#9fef9f',
        font: '10px/1.4 ui-monospace, Menlo, monospace',
        padding: '6px 8px',
        whiteSpace: 'pre',
        maxHeight: '45vh',
        overflow: 'hidden',
      }}
    >
      <div style={{ color: '#fff', marginBottom: 2 }}>
        {`ctx=${snap.ctxId}  state=${snap.state}  t=${snap.currentTime?.toFixed(2)}  pump=${snap.pumping}`}
      </div>
      <div style={{ color: '#fff', marginBottom: 2 }}>
        {`unlocked=${snap.unlocked}  started=${snap.started}  needRec=${snap.needsRecovery}  spine=${snap.spineRebuilt}  muted=${snap.muted}`}
      </div>
      {snap.log.slice().reverse().slice(0, 16).map((e, i) => (
        <div key={i}>{`${fmtTime(e.t)}  ${e.event}  [${e.state}]`}</div>
      ))}
    </div>
  )
}
