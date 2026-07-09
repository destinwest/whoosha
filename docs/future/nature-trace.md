# Nature Trace Game — Future Spec

> **Status: not scheduled. Do not build yet.**
> This is a parked design spec, kept out of `BRIEFING.md` so it doesn't add reading
> weight to every session. When Nature Trace is greenlit, move the relevant intent
> back into `BRIEFING.md` (§6, as a new game screen) and treat this file as the
> working reference. Until then, Claude Code should not read or build from this.

**Route:** `/games/nature-trace`
**Game slug:** `nature-trace`
**Unlock tier:** Paid
**Estimated play time:** ~5 minutes per picture
**Audience:** Child (immersive, same rules as the Square Breathing game page)

---

## 1. Concept

The child traces a sequence of line segments that together form a nature scene. At any given moment they are zoomed in close enough to see only the active segment they are tracing, set against a soft nature-textured background. They cannot see the full picture. When all segments are complete, the view slowly zooms out to reveal the whole image — which progressively fills with color as it appears.

The reveal is the emotional payoff. The tracing is the regulation mechanic.

## 2. The Picture — A Whale

The first Nature Trace picture is a **humpback whale** — a large, smooth, rounded creature made entirely of flowing curved lines. A whale is ideal for this game because:
- Its outline is made of long, graceful curves with no sharp angles — natural for slow tracing
- It is universally recognizable even from a partial reveal
- It carries an inherently calming, oceanic association that reinforces the breathing mechanic
- It fills a roughly square canvas naturally

The whale is defined as an ordered array of segments. Each segment has a start point, end point (or control points for curves), a breathing instruction, and a pacing duration. The full image is drawn on a virtual canvas of 1000×1000 units — all coordinates are in this space and scaled to the device at render time.

## 3. Segment Data Structure

Each segment in the picture is defined as a JavaScript object:

```js
{
  id: 1,
  type: 'quadratic',        // 'line' | 'quadratic' | 'cubic'
  from: [x, y],             // start point in 1000x1000 space
  control1: [x, y],         // for quadratic curves
  control2: [x, y],         // for cubic curves only
  to: [x, y],               // end point
  breath: 'in',             // 'in' | 'hold' | 'out' | 'hold'
  duration: 4,              // seconds for pacing circle to travel this segment
  strokeColor: '#5B9FAA',   // color of the line when traced
  fillRegion: null,         // null or region id — used for color fill on reveal
}
```

The full segment array for the whale picture lives in a content file (e.g. `whaleSegments.js`) under the game folder. Keep it as a pure content layer — changing it produces a different picture without touching any game logic.

## 4. Breathing Pattern

Uses the same four-phase box breathing pattern as Square Breathing, assigned per segment. Segments cycle through IN → HOLD → OUT → HOLD in order. Longer segments use up to 6 seconds; shorter segments use 4 seconds.

## 5. Camera and Zoom System

**During tracing (zoomed in):** viewport frames the active segment with generous padding (~2× segment length). Camera applied via canvas transform matrix.

**Between segments:** 2.5 second animated transition — camera pans and rescales from current viewport to next segment's viewport. Soft breathing cue appears during transition. Next start circle fades in when camera settles.

**On reveal:** camera animates over 4 seconds back to the full 1000×1000 canvas. Slow ease-out curve. Triggers color fill animation on completion.

## 6. Zoomed-In View — What the Child Sees

Background: soft nature texture (static, does not move with camera). Completed segments visible in stroke colors. Active segment slightly thicker in soft teal. Pacing circle, trace circle, fading trail. Breathing instruction text at bottom. Subtle dot progress indicator at top. Exit button always visible.

## 7. The Reveal — Color Fill Animation

Over ~6 seconds, color washes into fill regions progressively — largest areas first, like watercolor soaking into paper. Fill colors: whale body in deep teal-blue, belly in warm cream, fins in darker teal, eye in deep forest. Low-opacity layered passes simulate watercolor, not flat fill. Completion UI fades in after a 1.5 second pause: "You made this 🐋" with "Draw again" and "All done" buttons.

## 8. Segment Transition

When the pacing circle reaches a segment end: 2.5 second gap, completed segment glows briefly, breathing cue appears, next start circle fades in. The child's pace does not gate progression — the pacing circle alone determines timing.

## 9. Implementation Notes

Single canvas element. Two contexts if needed (background picture layer + animation layer). All coordinates in 1000×1000 space, converted via `scaleFactor = Math.min(screenWidth, screenHeight) / 1000`. Bezier curve projection via lookup table (~100 points per segment). Camera state as `{ x, y, scale }`, lerped between states using `performance.now()`. Session save on completion with `game_slug: 'nature-trace'`.

Reference the Square Breathing game (BRIEFING.md §6.4) for the canvas architecture and pacing-circle mechanic, and `POLISH-STRATEGY.md` for the iOS layering/perf rules that apply to any new game canvas.

## 10. Build Kickoff Prompt (when greenlit)

```
Build the Nature Trace game at /games/nature-trace. Read docs/future/nature-trace.md
in full before writing any code — every section matters.

Start with:
1. The whale segment content file (pure data, no logic)
2. The camera system — viewport calculation, smooth transitions, final zoom-out reveal
3. The canvas rendering — background, completed segments, active segment, pacing circle, trace circle, trail
4. The color fill reveal animation — watercolor-style progressive fill by region
5. The completion UI (§7 of this doc)
6. Session save to Supabase on completion

Follow BRIEFING.md §6.4 for the canvas architecture and pacing-circle mechanic, and
POLISH-STRATEGY.md for the layer budget and iOS perf rules.
```
