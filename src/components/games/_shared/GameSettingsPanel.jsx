import { useSettings } from '../../../hooks/useSettings'
import { useMutePref } from '../../../hooks/useMutePref'
import { useVoicePref } from '../../../hooks/useVoicePref'
import { GAME_OPTIONS, ATTRIBUTES } from '../../../data/gameOptions'
import { VOICES, VOICE_IDS } from '../../../sound/voices'

// ── GameSettingsPanel ─────────────────────────────────────────────────────────
// A calm modal that lets the player customize the current game. It is
// SCHEMA-DRIVEN: it reads GAME_OPTIONS[gameKey] + ATTRIBUTES and renders one
// control per customizable attribute — a switch for toggles, a segmented picker
// for enums with more than one allowed value. Enums with a single allowed value
// are skipped (nothing to choose yet), so the panel grows automatically as more
// values are wired in later phases. See docs/GAME-CUSTOMIZATION.md.
//
// Reads/writes through useSettings, so a change persists (localStorage mirror)
// and the game re-resolves immediately. No per-frame cost — this is DOM, mounted
// only while open; a background change triggers one re-bake (like a resize).

// Presentation labels (kept here, not in the pure schema module). Add entries as
// attributes/values are introduced.
const ATTR_LABEL = {
  background:   'Background',
  trackTexture: 'Track texture',
  writtenCues:  'Written instructions',
  spokenCues:   'Spoken instructions',
}
const VALUE_LABEL = {
  // backgrounds
  meadow: 'Day', meadowDusk: 'Dusk',
  // track textures
  dirt: 'Dirt', slate: 'Slate', screeFirn: 'Scree', candy: 'Candy', gradient: 'Smooth', arcs: 'Arcs', ribbon: 'Ribbon',
  nightSky: 'Night', sandstone: 'Sandstone', sky: 'Sky', field: 'Field', firstLight: 'First light', lake: 'Lake',
}
const valueLabel = (v) => VALUE_LABEL[v] ?? v

// Which attributes get a control: those not hidden (menu:false ⇒ default-only,
// not yet wired for this game), and among those, every toggle plus any enum
// with a real choice (more than one allowed value).
function controllableAttrs(gameKey) {
  const opts = GAME_OPTIONS[gameKey] ?? {}
  return Object.keys(opts).filter((attr) => {
    if (opts[attr].menu === false) return false
    const type = ATTRIBUTES[attr]?.type
    if (type === 'toggle') return true
    if (type === 'enum')  return (opts[attr].allowed?.length ?? 0) > 1
    return false
  })
}

export default function GameSettingsPanel({ gameKey, onClose }) {
  const { settings, setOption, reset } = useSettings(gameKey)
  const [muted, , setMuted] = useMutePref()   // global audio mute (not per-game)
  const [voiceId, setVoice] = useVoicePref()  // global spoken-cue voice (not per-game)
  const attrs = controllableAttrs(gameKey)

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        background: 'rgba(6,20,16,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 360,
          background: '#0F2E28', color: '#EAF3EF',
          borderRadius: 24, padding: '22px 22px 16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          fontFamily: "'Nunito', sans-serif",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Customize</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{
              width: 36, height: 36, borderRadius: 12, border: 'none',
              background: 'rgba(255,255,255,0.12)', color: '#EAF3EF', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Global audio mute — lives here (not per-game) so the top chrome stays
            uncluttered. On = sound plays. */}
        <div style={{ margin: '16px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, marginBottom: 8 }}>Sound</div>
          <Switch on={!muted} onChange={(soundOn) => setMuted(!soundOn)} />
        </div>

        {attrs.map((attr) => (
          <div key={attr} style={{ margin: '16px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, marginBottom: 8 }}>
              {ATTR_LABEL[attr] ?? attr}
            </div>
            {ATTRIBUTES[attr].type === 'toggle'
              ? <Switch on={settings[attr]} onChange={(v) => setOption(attr, v)} />
              : <Segmented
                  options={GAME_OPTIONS[gameKey][attr].allowed}
                  value={settings[attr]}
                  onChange={(v) => setOption(attr, v)}
                />}
          </div>
        ))}

        {/* Global voice picker — shown only where this game speaks (spokenCues on)
            and there's more than one voice to choose from. */}
        {settings.spokenCues && VOICE_IDS.length > 1 && (
          <div style={{ margin: '16px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, marginBottom: 8 }}>Voice</div>
            <Segmented
              options={VOICE_IDS}
              value={voiceId}
              onChange={setVoice}
              labelFn={(id) => VOICES[id].label}
            />
          </div>
        )}

        <button
          onClick={reset}
          style={{
            marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
            color: '#EAF3EF', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}

// A calm on/off switch.
function Switch({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 52, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
        background: on ? '#3FA98C' : 'rgba(255,255,255,0.18)',
        position: 'relative', transition: 'background 160ms ease',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24,
        borderRadius: '50%', background: '#fff', transition: 'left 160ms ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

// A segmented picker for enum attributes (and the global voice list).
function Segmented({ options, value, onChange, labelFn = valueLabel }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              flex: '1 0 auto', minWidth: 72, padding: '9px 14px', borderRadius: 12,
              border: active ? '1px solid #6FD3B4' : '1px solid rgba(255,255,255,0.18)',
              background: active ? 'rgba(63,169,140,0.28)' : 'transparent',
              color: '#EAF3EF', fontFamily: "'Nunito', sans-serif", fontSize: 14,
              fontWeight: 700, cursor: 'pointer', transition: 'background 140ms ease',
            }}
          >
            {labelFn(opt)}
          </button>
        )
      })}
    </div>
  )
}
