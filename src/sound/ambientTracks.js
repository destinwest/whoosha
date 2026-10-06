// ── ambientTracks ────────────────────────────────────────────────────────────
// Registry of selectable ambient beds — the audio counterpart to voices.js.
// Each track is a sampled, seamlessly-looped bed with its own tuned module
// (crossfaded loop + Haas widening); `create(ctx)` resolves to { output, dispose }.
//
// "Ambient" as a user option means the whole SOUNDSCAPE: the bed plus the breath
// whoosh that follows the pacing circle. The two are coupled — on together, off
// together — and the soundscape is an ALTERNATIVE to spoken instructions, never
// layered with them (user decision 2026-10-06: all of it at once is too
// stimulating). resolveAmbientTrack() below is that rule.
//
// Adding a track: write its module (see synthAmbient.js), add it here, and add
// its id to AMBIENT_VALUES in data/gameOptions.js.

import { createAmbient }    from './synthAmbient'
import { createHexAmbient } from './synthHexAmbient'

export const AMBIENT_TRACKS = {
  forest: { id: 'forest', label: 'Forest', create: createAmbient },      // Square's original bed
  canyon: { id: 'canyon', label: 'Canyon', create: createHexAmbient },   // Hexagon's original bed
}

export function createAmbientTrack(ctx, id) {
  const track = AMBIENT_TRACKS[id]
  if (!track) return Promise.reject(new Error(`ambientTracks: unknown track "${id}"`))
  return track.create(ctx)
}

// The soundscape a game should actually play, from its resolved settings:
// null (silent) when spoken instructions are on or ambient is 'off'/unknown,
// otherwise the track id.
export function resolveAmbientTrack(settings) {
  if (!settings || settings.spokenCues) return null
  return AMBIENT_TRACKS[settings.ambient] ? settings.ambient : null
}
