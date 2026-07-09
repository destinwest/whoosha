# Polish Strategy

How Whoosha adds visual richness (texture, lighting, atmosphere) to game scenes while holding 60fps on iPhone 12+.

This is a living doc. Update the **Decision log** at the end of each session that touches visual code.

---

## Perf budget

**Target hardware floor:** iPhone 12 (A14 Bionic, 4GB RAM, DPR=3, 60Hz).

| Resource | Budget |
|---|---|
| Frame time | 16.6ms (60fps); aim for ≤10ms in game loop, leave headroom for Safari/system |
| Compositing layers | ≤5 concurrent full-screen layers |
| Memory per full-screen layer at DPR=3 | ~12MB |
| Per-frame JS in render loop | <2ms |

## Why we have these rules — the failure modes

Two prior sessions broke iOS perf:

- **Session N-2 (SVG filters):** Applied `filter: url(#...)` referencing SVG `<filter>` chains (likely `feTurbulence` + `feColorMatrix`) to fullscreen or dynamic content. Filter graph re-evaluated on every paint; on iOS Safari several filter primitives run on CPU. Tanked.
- **Session N-1 (CSS overlay stack):** Pivoted to canvas-baked bg + 6 stacked `mixBlendMode: screen` divs. Each blend-mode div creates an isolated stacking context and compositing layer; multiple blend modes are GPU-expensive on iOS and several run partly on CPU. Eased the worst symptoms but still costly; current `main` inherits this layering.

The common failure mode: **per-frame visual cost scales with anything dynamic on screen — gauge changes, blur transitions, paint stroke — multiplying the layer composite work.**

---

## Strategy: Hybrid (bake static, animate one dynamic state)

Three strategies were considered:

| Strategy | Per-frame cost | Dynamic FX | Memory | Verdict |
|---|---|---|---|---|
| A. Bake everything | Near zero | None | Lowest | Too rigid |
| **B. Hybrid (chosen)** | Low (1–2 dynamic layers) | Limited but sufficient | Moderate | ✅ |
| C. Pre-baked variants + crossfade | Near zero | Discrete states | High (~70MB) | Overkill for now |

**Hybrid in practice:**
- Bake textures, gradients, lighting into offscreen canvases at resize → drawn as bitmaps
- Use exactly one CSS `filter: saturate()` for the dynamic heat gauge state
- Allow at most one additional CSS overlay (vignette) for elements that benefit from being above the game canvas

---

## Layering rules (the discipline)

1. **One bg canvas, one game canvas.** All static visual content goes into the bg canvas. No additional persistent layers below the game canvas.
2. **At most one CSS overlay above the game canvas** — currently the vignette div.
3. **No `mixBlendMode` stacks.** A single overlay using blend mode is okay if necessary; stacks are not. Move blend operations into the bake step (Canvas 2D `globalCompositeOperation`).
4. **`filter: blur` only during intro phase.** Remove `will-change: filter` after the phase transition to release the compositing layer.
5. **DPR-aware sizing for every canvas.** Width/height attributes scale by `devicePixelRatio`; CSS dimensions stay in CSS pixels; `ctx.scale(dpr, dpr)` so drawing code stays in CSS-px coordinates.
6. **One `filter: saturate()`** on the wrapper that includes both bg canvas and game canvas. Gauge desaturates everything in lockstep.
7. **Stacked canvas siblings must share positioning.** If two or more canvases live as siblings in a wrapper, **all** must use `position: absolute`. CSS paints positioned elements above non-positioned siblings regardless of DOM order — an opaque baked canvas will silently cover a static-positioned sibling. (Lesson from 2026-05-19, Step 1.)

### Reference architecture

```
[saturate(var(--game-saturation)) wrapper]   ← one GPU filter, gauge-driven
  ├─ [bg canvas, baked]                       ← SVG textures + lighting + gradients
  ├─ [game canvas]                            ← dynamic paint / fingerprint / trace
  └─ [pacing canvas]                          ← pacing circle, isolated from paint compositing
[vignette div]                                ← outside the filter, anchors the frame
```

Four GPU layers total (Square/Hexagon use bg + game; Infinity splits the pacing circle onto its own canvas — see the 2026-07-02 Decision log entry). The layer budget (≤5 concurrent full-screen layers) still holds with headroom on iPhone 12. The pacing canvas counts against the budget — do not add further persistent canvases without baking something else down first.

---

## SVG handling: what's cheap, what's expensive

SVG is preferred for authoring — the aesthetic is richer than what Canvas 2D primitives produce. The performance question is **how** the SVG reaches the screen.

### Cheap on iOS

| Use | iOS cost |
|---|---|
| Static `.svg` asset loaded as `<img>` or `background-image` | One-time rasterization → GPU texture |
| SVG drawn once into an offscreen canvas via `drawImage` | One-time cost at resize; per-frame zero |
| SVG used as `ctx.createPattern()` source | Cached GPU texture after first paint |
| SVG with `<defs>` patterns (no `<filter>`) | Composites like any vector |

### Expensive on iOS — do not do

- `filter: url(#paperGrain)` applied to anything that animates, scales, or transforms — filter graph re-evaluates each paint
- `feTurbulence` evaluated per-frame
- Multi-stage SVG filters whose result region spans the viewport, even one-time
- Inline `<svg>` with `<filter>` inside an element that game code also paints into

### The key move

**Pay the SVG cost once at resize, bake it into a bitmap, never re-evaluate.** SVG is a great authoring format and a terrible runtime format on iOS. Use it as the former, not the latter.

---

## Heat-gauge desaturation + baked content

CSS `filter: saturate()` works on baked canvas content. The filter applies to the *rendered bitmap* of the layer regardless of what produced it (canvas, SVG, image, div).

- **One filter on the wrapper that includes bg canvas + game canvas** — both desaturate together as a unit.
- **GPU color-matrix op at composite time**, well under 1ms on iPhone 12.
- The bake (SVG → canvas bitmap) and the filter (bitmap → screen) are separate pipeline stages and don't interact.

Do **not** desaturate via `ctx.filter` per-frame, `getImageData` pixel ops, or re-baking the bg canvas on gauge change.

---

## Technique catalog

### Track texture
- **Authoring:** static `.svg` (paper grain, brush hatching, etc.)
- **Runtime:** at resize, load via `Image` → draw to offscreen canvas at track resolution → use as `ctx.createPattern()` for racetrack passes
- **Per-frame cost:** zero (GPU texture after first paint)

### Background texture
- **Authoring:** static `.svg`
- **Runtime:** at resize, `drawImage` into the offscreen canvas inside `buildMeadowBg`, composited with the base gradient via Canvas 2D blend modes
- **Per-frame cost:** zero

### Ambient lighting
- **Authoring:** static `.svg` light-pool assets (radial blooms, shafts)
- **Runtime:** baked into the bg canvas at resize using `globalCompositeOperation = 'screen'` (or `'overlay'`) — all composition happens in canvas-land, not CSS
- **Per-frame cost:** zero
- **Animated variant (optional, not currently used):** if static lighting feels flat, an animated lighting overlay is possible but requires freeing the single CSS overlay slot first — the vignette would have to be baked into the bg canvas (as a darkening pass in `buildMeadowBg`) before adding one animated div (SVG-as-`background-image`, slow opacity/transform, no `mixBlendMode` stack).

### Vignette
- Current implementation is a CSS `radial-gradient` div — keep. Cheap, single layer, no SVG needed.

### Heat-gauge desaturation
- CSS `filter: saturate(var(--game-saturation))` on the wrapper containing bg canvas + game canvas.
- Currently in `main` the bg canvas is *outside* this wrapper — fix in Step 1 refactor.

---

## Anti-patterns (locked, do not revisit)

- ❌ `filter: url(#...)` on animating/transforming content
- ❌ `feTurbulence` evaluated per-frame
- ❌ Multi-stage SVG filters spanning the viewport
- ❌ Stacks of `mixBlendMode` divs (current `main` has 6)
- ❌ Animated CSS `filter` chains during gameplay
- ❌ DOM-based per-frame visual effects
- ❌ `getImageData` / per-pixel JS for desaturation or color shifts
- ❌ Re-baking the bg canvas on gauge change
- ❌ Canvases sized without DPR scaling

---

## Current state

This is the single source of live status: the **Decision log** at the end of this file. Do not add a dated snapshot here or in `CLAUDE.md` — snapshots in two places drift apart. Append to the log instead.

---

## Decisions and dropped scope

- **Lap-color background tint — DROPPED (2026-05-19).** BRIEFING previously specified that the background edges crossfade a faint lap-color tint on each lap. Incompatible with the baked-bg architecture without re-baking or adding overlay layers. Removed from spec; lap progress is communicated entirely through the painted stroke.

---

## Decision log

Append a one-line entry after each session that touches visual code. Format: `YYYY-MM-DD — what was tried — what stuck`.

- 2026-05-19 — Strategy doc drafted; chose Hybrid approach; SVG-as-baked-bitmap unblocked; refactor of `main` queued as Step 1.
- 2026-05-19 — Doc audit: resolved conflicts between BRIEFING and POLISH-STRATEGY. stampStroke confirmed as new Classic; heat gauge moved into BRIEFING; lap-color bg tint dropped; CSS-filter policy in BRIEFING replaced with pointer to this doc.
- 2026-05-19 — Step 1 refactor: baked 6 CSS overlays into `buildMeadowBg`; fixed DPR; moved `bgCanvas` inside the saturate wrapper. Compositing layers ~11 → ~4. Hit CSS painting-order gotcha — opaque positioned `bgCanvas` covered static-positioned `SquareCanvas`. Fixed by making SquareCanvas's `<canvas>` element `position: absolute`. New layering rule #7 added.
- 2026-05-24 — Adaptive sound design landed (4 phases, 4 commits). Pure Web Audio API synthesis — zero audio assets, ~10 KB JS net. Architecture: `SoundDirector` owns the AudioContext + bus spine; `SquareCanvas` fires a per-frame `onGameStateTick` snapshot (gaugeEffect, gaugeActive, synergyStage, breathPhase, speedRatio) consumed by the director. Three sonic states map to the game's three nervous-system states: regulated (procedural stream + breeze + Poisson-scheduled leaves built from pink/brown noise buffers), dysregulated (lowpass sweep 18k→600 Hz + level attenuation + leaves fade-out + 50 Hz rumble bus rising), synergistic (4-partial near-just-intonation singing bowl with breath-locked ±20% gain swell at 1/16 Hz). Per-frame param updates via `setTargetAtTime` + change-throttling (>0.5%) — no zipper noise, no ramp queue buildup. iOS unlock via existing `onPointerDown` on the game container; visibilitychange suspends the context when the tab hides. Legacy `squareGameForestLoop.mp3` (470 KB) retired. **New rule for next session: do not add `.mp3` / `.wav` audio assets — all game audio is synthesized.** Subjective verification on iOS hardware is pending.
- 2026-06-02 — "No samples" rule from 2026-05-24 reversed after extensive synthesis iteration on the regulated-state foundation: pure synthesized forest-meadow ambience repeatedly read as "rushing wind" or "ocean waves," not natural ambience. Pivoted to a sampled ambient bed (`squareGameAmbience.mp3`, ~2.4 MB) crossfade-looped + Haas-widened from mono in code. Synth remains the right tool for *gestural* elements (breath cues, singing-bowl partials) where parametric control is essential. **Updated rule:** samples allowed for atmospheric/textural beds; pure synthesis for cued / breath-coupled / progressively-built elements. The hybrid model (samples for what synthesis is bad at, synth for what synthesis is great at) is the durable answer.
- 2026-06-02 — Dead-code cleanup. Deleted `PaceTracker.jsx` stub, `taperedStroke.js` (completing the queued cleanup), `src/lib/stripe.js` and the `@stripe/stripe-js` npm package (Stripe deferred to post-MVP). Kept `CompletionScreen.jsx` (now implemented as the session-end card) and `DragonGame.jsx` (Rive spike kept as proof-of-concept for the eventual Dragon game). One stale comment in `layeredWash.js` referencing taperedStroke fixed. Net: -3 files, -1 npm dependency.
- 2026-07-01 — Hexagon: shortened the two "hold" sides so the pacing circle's linear speed is constant across the whole lap (holds run 2000ms vs 4000ms, so at equal side length they were 2× fast). Hexagon is now irregular-but-symmetric: breathe sides keep length R + ±30° directions, only the verticals shrink (width and all 120° interior angles unchanged, height 2R→~1.5R). `buildGeo` builds from explicit vertices + per-side straight-fraction (`sfArr`); new shared `roundedPolyPath`/`offsetPolygon` replace `roundedNgonPath` for the track passes + paint clip so the visible track follows the same vertices as the traceable centerline. Pure geometry — **zero perf cost** (no new layers, no per-frame work).
- 2026-07-01 — Hexagon label pulse fix. The label-proximity block was Square-copied and never adapted: it walked only 4 sides (`*4` / `i<4`) so labels 4 & 5 never grew, and it estimated the pacing position with a LINEAR time→fraction map, which the 4-4-2 timing (and shortened holds) made wrong for every side past the first hold — only the two north sides looked right. Now driven off the pacing circle's actual `getPacing` fraction over all 6 sides, with per-side straight-fractions (sfi for the label's side, sfp for the previous side's approach arc). Verified in-browser: all six peak at scale 1.5 in strict cyclic order, peak-to-peak intervals match the side durations exactly (4-4-2). Zero perf cost.
- 2026-07-02 — Infinity game scaffold (branch `infinity-breathing`). Vertical lemniscate figure-8; track width from the shared `min(w,h)*0.78*0.0728` handle so `lw`/circleR/pacing match Square+Hexagon pixel-for-pixel. Lazy-8 breath (inhale=top lobe, exhale=bottom, constant arc-length pacing, no holds, starts at the crossover). The shared local-arc-length-window groove core handles the center crossover for free (opposite strand excluded by arc distance, not pixel distance). New baked `buildNightSkyBg` — deep-blue Milky Way + purple/gold nebulae + seeded (mulberry32) star field, baked once per resize, **zero per-frame cost**; star seed fixed so re-bakes don't reshuffle. Layer budget respected: one bg canvas + one game canvas + pacing canvas + the allowed vignette overlay. Deferred to keep the scaffold clean: painted finger-trail (needs a path-based annular clip for the self-crossing curve — the hard part), ember/bloom/particles, encouragement, label pulse, bedtime audio. Desktop-preview verified (shape, clean console); on-device look pending.
- 2026-07-02 — Infinity carousel integration (now on `main`). Unlocked the card (`locked: false`), wired the launch transition, and gave it a card preview. FadeLaunch is route-driven + game-agnostic (ignores `fromRect`) and locked/route-less cards already return earlier, so the `handleCardClick` transition was generalized from a square/hexagon allowlist to *every unlocked game* — future unlocks inherit it. New `InfinityCardPreview`: static, DPR-aware, single-draw (no rAF) full-bleed render of the vertical figure-8 (flat lavender track) on a calm night gradient + a few faint seeded stars + one quiet pacing dot — mirrors Square/HexagonCardPreview; card-tuned fit (`VFILL 0.74`, `cy 0.43`) so the bottom lobe clears the title. `CarouselCard` treats infinity as a preview card (full-bleed thumbnail + bottom-floated title, light title colour on the dark night card). Zero per-frame cost. Verified in-browser: card matches the family, FadeLaunch veil fires, lands on `/games/infinity`, clean console.
- 2026-07-02 — Infinity water-trace stroke, first pass (branch `infinity-water-stroke`, off `main`). New stroke type: "finger through water." (1) Track made INVISIBLE — geometry (points/cumLen) still guides the pacing circle + groove bead; the band draw is gated behind a `SHOW_TRACK` dev flag (default false). (2) Ripple stroke = a soft glowing lavender WAKE (radial-gradient blobs deposited along the fingertip, distance-gated + idle tick, additive `lighter` blend) + expanding RIPPLE RINGS shed every ~1.15 lw of travel (plus idle ring + larger touch-down "plop"). Both pooled + hard-capped (48 wake / 16 rings), recycling the most-faded slot → bounded per-frame arc/gradient fills, **no new layers, no filters, no per-pixel work** (iOS-compliant). Drawn on the game canvas above the invisible track, below the pacing circle, so it desaturates with the heat gauge. On lift, emission stops and the pool finishes fading (water settles). Tunable knobs grouped at top of `InfinityCanvas`. Desktop-verified (emits, clean console); **on-device calibration pending** — first pass reads a touch heavy/bright for "lightly tracing" (additive stacking blows toward white on slow/overlapping traces); dial `WAKE_ALPHA` / consider `source-over` if too strong.
- 2026-07-02 — Infinity water stroke, second pass — glow REPLACED with surface disturbance (user feedback: v1 read as "a trail of blurry white light that emits circles," not water). Chose "refract the sky + reactive surface." Extracted the night-sky bake to `nightSky.js` so the game canvas can bake an identical copy (fixed seed) and REFRACT it. Three cues, all on the game canvas, all bounded (no shaders, no `getImageData`, no filters — only arc/gradient fills + `drawImage` blits of the baked bitmap): (1) fingertip LENS — a refractive dimple that magnifies the baked stars via `LENS_RINGS` (8) concentric clipped `drawImage` blits of the sky sub-rect, magnification easing to 1× at the rim so it blends seamlessly, + a thin meniscus trough (`0.85R`) and a bright Fresnel rim; (2) lit RIDGES — dark trough + bright moonlit crest wavefronts shed along the drag (overlapping fronts = wake), replacing the glow rings; (3) REACTIVE STARS — a seeded dynamic sparkle layer that brightens + bobs as a ridge front sweeps past. Bugs fixed mid-pass: duplicate `smoothstep` decl (compile), and the ridge trough collapsing into a filled dark disc at small radius (now gated on `troughR > wCrest*1.6`); lens depression softened from a dark disc to a thin inner-rim trough so refraction shows. Honest limitation noted: refraction only reads over stars/nebula (dark-magnified-dark is invisible), so rim + ridges + reactive stars carry most of the load. Perf: `LENS_RINGS` clipped blits + ≤22 ridge strokes + ~34 star fills per frame — bounded, iOS-compliant. **On-device feel-tuning pending** (built blind; preview throttles animation).
- 2026-07-02 — Infinity water stroke, third pass — STRIPPED BACK to just a wake (user feedback: v2 still "does not read as water"; disliked the touch-triggered lens specifically; rings too much; reactive stars unhelpful; core principle restated — the game calms the nervous system, so the finger effect must be *subtle + soothing*, less output, less frequent). Removed the lens, ripple ridges, reactive stars, and the refraction machinery in `InfinityCanvas` (`nightSky.js` kept — still used by `InfinityGame`'s bg). Sole effect now: a soft WAKE that trails the fingertip and heals behind it. Impl: a buffer of interpolated recent finger positions `{x,y,age}`; each frame age + prune (points expire at `WAKE_LIFE_MS` 1400 → the water "heals"), then draw as ONE smooth quadratic ribbon (through-midpoint smoothing = no beading) in 3 overlapping head-biased passes (full length faint+wide → recent → head tight+firmer); overlap sums to a soft head→tail gradient; a `globalFade` keyed to the newest point's age fades the whole thing out after lift. Source-over (never additive), peak alpha 0.15, cool moonlight-lavender, base width 0.42 lw. Perf: 3 strokes/frame. Reads as a calm furrow closing back up. **On-device feel still to confirm** (preview throttles animation; beading in v3.0 was a throttle artifact + round-capped per-band strokes — fixed by the single smooth path).
- 2026-07-02 — Infinity wake, fourth pass — shape it into a BOAT WAKE (user: "okay," wants more aesthetically pleasing; narrow at the bow/finger, spreading behind, dissipating to nothing; max width ≈ pacing-circle diameter). Width must vary along the trail, which a single stroke can't do. Tried a filled varying-width ribbon (polygon of left/right edges) — read as a solid translucent SLAB and splayed/jagged where the path curves sharply (top apex, crossover): a filled ribbon fights curved paths. Switched to SOFT DABS: bake a 64px radial-falloff sprite once (smoothstep alpha, tinted `WAKE_COLOR`, via `createImageData`), then blit it (scaled) at every trail point with `globalAlpha = WAKE_ALPHA(0.055)·globalFade`. Radius = a **position-based** boat-wake profile (not age — age barely advances under preview rAF throttle so the taper wouldn't show): `p=(n-1-i)/(n-1)` (0 bow→1 tail), width = `0.5·wMax·spread·taper` with `WAKE_HEAD_W 0.16`, peak at `WAKE_PEAK_POS 0.55`, taper→0 at tail. Overlapping low-alpha source-over dabs = a soft feathered varying-width wisp; graceful on curves; dissipates via radius→0 + prune + `globalFade`. `wMax = 1.20 lw` (≈ pacing diameter). Perf: ~n≤150 sprite blits/frame (no per-frame gradient creation). Desktop screenshot reads as a soft tapered wake — big aesthetic improvement. **On-device feel + width/length/alpha tuning still pending.**
- 2026-07-02 — Infinity wake, fifth pass — CANOE V-WAKE (user sent 2 reference photos of canoe wakes: the read is two soft DIVERGING ARMS forming a V behind the boat, calm water between — not a center wisp). Also: keep it SHORT + close (~1 inch), ~1.6s dissipation is good. Reused the dab sprite but now draw TWO arms: at each trail point, blit the dab offset ±perpendicular from the path by `off = maxHalf·p` (p=0 bow→1 tail), so the arms converge at the finger and spread to `WAKE_WIDTH_LW 1.10 lw` total at the tail; arm alpha `WAKE_ALPHA(0.075)·globalFade·(1-p)²` fades to nothing at the tail (dissipate). Arm thickness `WAKE_ARM_R_LW 0.16 lw`. Length limited by an ARC-LENGTH trim (`WAKE_LENGTH_LW 2.0 ≈ 1 inch`) so the wake stays short + close regardless of drag speed; `WAKE_LIFE_MS 1600` still governs post-lift heal via `globalFade`. Perf: ~2·n≤180 sprite blits/frame. Desktop screenshot shows a small soft V behind the finger (throttle makes it sparse; real 60fps will read cleaner). **On-device confirm pending.**
- 2026-07-02 — Infinity wake, sixth pass — FEATHERED wavelets (user: the reference arms aren't solid lines, they're a repetition of small wave shapes; keep the V envelope but make the arms wave-like). Replaced the two continuous dab-arms with discrete CRESCENTS: walking back from the finger, every `WAVELET_SPACING_LW 0.30` shed one crescent = a short arc of `WAVELET_SAMPLES 6` soft dabs (radius `WAVELET_DAB_R_LW 0.12`) spanning ±`(maxHalf·p)` across the normal, bowed toward the finger by `WAVELET_BOW 0.40`·half (parabolic). Crescents grow wider + fade `(1-p)²` toward the tail → the V envelope, dissipating. Length still arc-length-trimmed to `WAKE_LENGTH_LW 2.0`. Reads as nested soft arcs (feathered wake) rather than solid arms. Perf: ~(#wavelets≈7)·6 = ~40 blits/frame. **On-device confirm pending; bow direction easy to flip (WAVELET_BOW sign). Open follow-ups: defined vs misty, pace-reactivity, pause behavior, wavelet spacing/count feel.**
- 2026-07-02 — Infinity wake, seventh pass — TWO feathered arms + finger CENTERED (user: combine v5 two-arms with v6 concentric wavelets = two arms each made of concentric curved wavelets, clear middle; and don't let the wake just trail — put the finger at the CENTER with the arms emanating from the front-sides, per the canoe photos where the wake wraps the hull, not just drags behind). Build a SPINE from a bow ahead of the finger (extrapolated `WAKE_FRONT_LW 1.1 lw` along a smoothed `headingRef`) back through the finger and along the trail (`WAKE_LENGTH_LW 1.3 lw` behind) → finger sits at spine distance `fingerAt = WAKE_FRONT_LW`, i.e. centred. Walk the spine every `WAVELET_SPACING_LW 0.28`; shed a PAIR of little crescents offset ±`off = maxHalf·q` (q = dist/spreadLen, 0 bow→1 tail), each crescent a short arc (`WAVELET_LEN_LW 0.26`, `WAVELET_SAMPLES 6` dabs `WAVELET_DAB_R_LW 0.11`) bowed toward the bow `WAVELET_BOW 0.55`. Skip where `off < wl` (clean bow, clear middle between arms). Alpha brightest at the finger, easing to 0 fore (bow) + aft (tail); `globalFade` heals on lift. Reads as two nested-arc arms with the finger centred. Perf ~2·(#pairs)·6 blits/frame. **On-device confirm pending; front-extrapolation is straight (heading), so may diverge slightly from the path on sharp curves — acceptable for a short wake. Open: arm crescents currently bow the same way (not mirrored L/R) — revisit if it reads wrong; plus earlier open Qs (misty vs defined, pace-reactivity, pause).**
- 2026-07-02 — Infinity wake, eighth pass — SHED-AND-LEFT-BEHIND particles (user: v7's arms "follow" the finger; the wake should be LEFT BEHIND like a canoe's — as the finger moves it should generate new waves in each arm that grow, spread apart, then dissipate). Rewrote as a particle system, ditching the per-frame spine rebuild + trail buffer. As the finger moves, every `SHED_SPACING_LW 0.20` of travel emit a PAIR of wavelet particles `{x,y (world birth pos), nx,ny (normal), fx,fy (heading), side, age}` (interpolated for fast drags, pool cap `WAKELET_MAX 110`, recycle oldest). Each is WORLD-ANCHORED (does not follow the finger). Per frame: `t=age/maxLife` (`WAKELET_LIFE_MS 1600`), offset `= INIT_OFF 0.10 + SPREAD 0.52·t` lw (drifts outward → arms diverge), half-length `= INIT_LEN 0.10 + GROW 0.24·t` lw (grows), alpha `= WAKE_ALPHA 0.12 · min(1,t/0.12)·(1-t)` (quick fade-in → fade to nothing); crescent = `WAKELET_SAMPLES 6` dabs (`WAKELET_DAB_R_LW 0.11`) bowed toward heading `WAKELET_BOW 0.55`. Because young wavelets are near the finger + centreline and old ones (further back, shed earlier) have spread + grown + faded, a diverging V is LEFT BEHIND along the path — and it follows curves naturally (no extrapolation). Desktop screenshot: wavelets strung along the traced path (correct); grow/spread not visible under preview rAF-throttle. Perf ~2·(#live pairs)·6 blits/frame. **On-device confirm pending. Knobs `WAKELET_*`/`SHED_*`/`WAKE_ALPHA` at top of `InfinityCanvas`.**
