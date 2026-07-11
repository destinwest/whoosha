// ── Home carousel game roster ─────────────────────────────────────────────────
// Single source of truth for the 8 cards on /home. Order matters: array index
// determines fan position. Square is at index 3 so it's the default center
// card on first load.
//
// Locked is currently hardcoded — Square, Infinity, Hexagon, and Triangle are
// free; only the "more breath soon" placeholders are locked (coming-soon). When
// the paid tier is wired up, derive `locked` from the user's profiles.tier.

export const HOME_GAMES = [
  { id: 'p1',       name: 'more breath soon',  tagline: '',                  route: null,              gameKey: 'placeholder', shape: 'mystery',  locked: true,  placeholder: true  },
  { id: 'p2',       name: 'more breath soon',  tagline: '',                  route: null,              gameKey: 'placeholder', shape: 'mystery',  locked: true,  placeholder: true  },
  { id: 'infinity', name: 'Infinity Breathing', tagline: 'Trace the infinity', route: '/games/infinity', gameKey: 'infinity',    shape: 'infinity', locked: false, placeholder: false },
  { id: 'square',   name: 'Square Breathing',   tagline: 'Trace the square',   route: '/games/square',   gameKey: 'square',      shape: 'square',   locked: false, placeholder: false },
  { id: 'hexagon',  name: 'Hexagon Breathing',  tagline: '',                   route: '/games/hexagon',  gameKey: 'hexagon',     shape: 'hexagon',  locked: false, placeholder: false },
  { id: 'triangle', name: 'Triangle Breathing',  tagline: 'Trace the triangle', route: '/games/triangle', gameKey: 'triangle',    shape: 'triangle', locked: false, placeholder: false },
  { id: 'star',     name: 'Star Breathing',      tagline: 'Trace the star',     route: '/games/star',     gameKey: 'star',        shape: 'star',     locked: false, placeholder: false },
  { id: 'p4',       name: 'more breath soon',  tagline: '',                  route: null,              gameKey: 'placeholder', shape: 'mystery',  locked: true,  placeholder: true  },
]

// Index of the card that starts in the center on first load (Square).
export const HOME_DEFAULT_INDEX = HOME_GAMES.findIndex((g) => g.id === 'square')

// Per-card background gradients keyed by gameKey.
export const GAME_GRADIENTS = {
  square:      'linear-gradient(160deg, #C8E0CD, #A0C8B0)',
  hexagon:     'linear-gradient(160deg, #E4B48C, #C77E5A)',
  infinity:    'linear-gradient(160deg, #D2C9E5, #B0A3D0)',
  triangle:    'linear-gradient(160deg, #CAD8DD, #8FB8CE)',
  star:        'linear-gradient(160deg, #FCF6DB, #A7C2F7)',
  placeholder: 'linear-gradient(160deg, #E0E8DF, #BFCEC1)',
}
