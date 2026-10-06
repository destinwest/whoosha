// ── voices ───────────────────────────────────────────────────────────────────
// The registry of selectable voice packs for spoken breath cues. A pack maps
// each cue → clip URL. See docs/GAME-CUSTOMIZATION.md.
//
// INVARIANT (target): every pack should eventually provide the full breath cue
// set { in, out, hold } so any voice works in any game. Until a clip exists it
// is simply omitted — play() no-ops for a missing cue (see voice.js) — which is
// why games needing 'hold' (Square/Triangle/Hexagon/Rainbow) stay gated off
// until their cue drivers are wired; in/out-only games (Star/Infinity/Heart)
// work with the current clips today.
//
// `intro` is optional and currently Star-specific (its ~5.4s opening narration).
// A second voice without its own intro would fall back to no intro on Star.

export const VOICES = {
  faith: {
    id: 'faith',
    label: 'Faith',
    clips: {
      in:    '/sounds/Faith/FaithBreatheIn.mp3',
      out:   '/sounds/Faith/FaithBreatheOut.mp3',
      hold:  '/sounds/Faith/FaithHold.mp3',
      intro: '/sounds/Faith/FaithIntro.mp3',
    },
  },
}

export const VOICE_IDS    = Object.keys(VOICES)
export const DEFAULT_VOICE = 'faith'

// Normalize any stored/selected id to a real one (graceful fallback, mirroring
// the settings resolver's guardrail).
export function resolveVoiceId(id) {
  return VOICES[id] ? id : DEFAULT_VOICE
}
