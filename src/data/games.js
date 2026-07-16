// ── Home carousel game roster ─────────────────────────────────────────────────
// Single source of truth for the 8 cards on /home. Order matters: array index
// determines fan position. Square is at index 3 so it's the default center
// card on first load.
//
// Locked is currently hardcoded — Square, Infinity, Hexagon, Triangle, and Star
// are free; Heart, Rainbow, and Flower are named future games (locked,
// coming-soon) with no game folder yet. When the paid tier is wired up,
// derive `locked` from the user's profiles.tier.

export const HOME_GAMES = [
  { id: 'heart',    name: 'Heart Breathing',   tagline: '',                  route: null,              gameKey: 'placeholder', shape: 'heart',    locked: true,  placeholder: false },
  { id: 'rainbow',  name: 'Rainbow Breathing', tagline: 'Climb the rainbow',  route: '/games/rainbow',  gameKey: 'rainbow',     shape: 'rainbow',  locked: false, placeholder: false },
  { id: 'infinity', name: 'Infinity Breathing', tagline: 'Trace the infinity', route: '/games/infinity', gameKey: 'infinity',    shape: 'infinity', locked: false, placeholder: false },
  { id: 'square',   name: 'Square Breathing',   tagline: 'Trace the square',   route: '/games/square',   gameKey: 'square',      shape: 'square',   locked: false, placeholder: false },
  { id: 'hexagon',  name: 'Hexagon Breathing',  tagline: '',                   route: '/games/hexagon',  gameKey: 'hexagon',     shape: 'hexagon',  locked: false, placeholder: false },
  { id: 'triangle', name: 'Triangle Breathing',  tagline: 'Trace the triangle', route: '/games/triangle', gameKey: 'triangle',    shape: 'triangle', locked: false, placeholder: false },
  { id: 'star',     name: 'Star Breathing',      tagline: 'Trace the star',     route: '/games/star',     gameKey: 'star',        shape: 'star',     locked: false, placeholder: false },
  { id: 'flower',   name: 'Flower Breathing',  tagline: '',                  route: null,              gameKey: 'placeholder', shape: 'flower',   locked: true,  placeholder: false },
]

// Index of the card that starts in the center on first load (Square).
export const HOME_DEFAULT_INDEX = HOME_GAMES.findIndex((g) => g.id === 'square')

// Per-card background gradients keyed by gameKey.
export const GAME_GRADIENTS = {
  square:      'linear-gradient(160deg, #C8E0CD, #A0C8B0)',
  hexagon:     'linear-gradient(160deg, #E4B48C, #C77E5A)',
  infinity:    'linear-gradient(160deg, #2E77CC, #0656AB)',   // royal-blue lake — see lakeSurface.js
  triangle:    'linear-gradient(160deg, #9AA3C9, #52587B)',   // periwinkle → the game sky's near-ridge purple
  star:        'linear-gradient(160deg, #1B1F4D, #141238)',   // night sky
  rainbow:     'linear-gradient(160deg, #FEFAE6, #F6E4AE)',
  placeholder: 'linear-gradient(160deg, #E0E8DF, #BFCEC1)',
}
