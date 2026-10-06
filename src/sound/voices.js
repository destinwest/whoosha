// ── voices ───────────────────────────────────────────────────────────────────
// The registry of selectable voice packs for spoken breath cues. A pack maps
// each cue → clip URL. See docs/GAME-CUSTOMIZATION.md.
//
// Every pack provides the full cue set { in, out, hold } plus an `intro` (Star's
// opening narration), so any voice works in any game. Clips live in
// public/sounds/<Name>/<Name>{BreatheIn,BreatheOut,Hold,Intro}.mp3 — adding a
// voice is: drop a folder in, add its name to the list below. A missing clip is
// tolerated (play() no-ops for that cue — see voice.js).

const pack = (name) => ({
  id: name.toLowerCase(),
  label: name,
  clips: {
    in:    `/sounds/${name}/${name}BreatheIn.mp3`,
    out:   `/sounds/${name}/${name}BreatheOut.mp3`,
    hold:  `/sounds/${name}/${name}Hold.mp3`,
    intro: `/sounds/${name}/${name}Intro.mp3`,
  },
})

// Faith is the original voice and the default. Order here = order in the picker.
export const VOICES = Object.fromEntries(
  ['Faith', 'Nicole', 'Lola', 'Neil', 'Josh', 'Jamal'].map((n) => [n.toLowerCase(), pack(n)]),
)

export const VOICE_IDS    = Object.keys(VOICES)
export const DEFAULT_VOICE = 'faith'

// Normalize any stored/selected id to a real one (graceful fallback, mirroring
// the settings resolver's guardrail).
export function resolveVoiceId(id) {
  return VOICES[id] ? id : DEFAULT_VOICE
}
