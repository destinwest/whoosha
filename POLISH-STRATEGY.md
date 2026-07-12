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
- 2026-07-09 — Square track recolored darker (user request): `buildTrackGradient` in `SquareCanvas.jsx` shifted from the cream ramp (`#FAF2E0`/`#F2EAD0`/`#E6DBBF`) to a warm-umber ramp (`#927567`/`#8A6D57`/`#7E5E46`), same 3-stop shape/positions so the "lit from above" shading is preserved; pre-gradient fallback `strokeStyle` updated to match. Checked the dirt-speck texture (`public/textures/track-dirt.svg`) against the new base and the math showed all three fleck layers losing most of their contrast (large soft mottles ~7% opacity would nearly vanish; the dominant small-speck layer would drop to roughly a third of its prior visibility) — so darkened + moderately raised opacity on all three layers to restore comparable contrast against the new base: mottles `#7a6240@.07`→`#4a3a24@.11`, dominant specks `#5a4a2e@.20`→`#3a2e1c@.28`, pebble accents `#3d3220@.18`→`#241d12@.30`. Pure color/SVG tuning — zero perf cost, no new layers. Build verified clean. **Not touched (flagged for user, not auto-changed): Hexagon's `HexagonCanvas.jsx` and the landing-page demo (`LandingPage.jsx`, `DEMO_BASE_COLOR`) independently define the same old cream tones and are now visually inconsistent with Square's track if left as-is; Square's own carousel card (`SquareCardPreview.jsx`, flat `#ECE6D6` track + `#F4F0E6` pacing dot) will also mismatch the game at the launch-bloom handoff. On-device color/contrast confirm pending — this was tuned by calculation, not by eye.**
- 2026-07-09 — Infinity wake, ninth through twenty-fifth pass — MERGED TO MAIN (branch `infinity-wake`, v9 reverted at `f6ccc80`, landed at `7535316`). v9's birth-tuning attempt (smaller/opaque/side-front birth) was reverted same-session — user: "something went wrong," diagnosed as dab radius chained through the already-tiny birth half-length, collapsing to sub-pixel. v10 redid the same intent with dab radius on its own independent linear ramp instead. v11 added per-wavelet spawn-time jitter (size/life/fade/bow/position, ±14-35%) so no two wavelets — not even a spawned L/R pair — are identical, fixing a "stamped, metronomic" look. v12 replaced stamped circular dab sprites with ONE filled tapered-ribbon polygon per wavelet (centerline + per-sample unit normals via finite difference + parabolic taper), removing the baked dab sprite entirely; user: reads as "composed of smaller pieces," wanted one whole shape. v13 thinned the ribbon and sharpened the taper exponent (`WAKELET_TAPER_POWER` 1.8) so it reads as a slender arc, not a half-circle blob. v14 doubled both birth and final wavelet size (length + thickness). v15/v17/v23 each cut shed frequency 25% (compounding, `SHED_SPACING_LW` 0.20→0.4741 = 0.20/0.75³). v16 cut center thickness a further 25% (user picked the amount via AskUserQuestion after saying they weren't sure how much). v18 tilted each wavelet's tip axis 45° off perpendicular-to-travel using a side-corrected "true outward" axis (`io = nx·side`) so it mirrors correctly for both arms — matching reference photos where the near-boat tip is pulled forward and the far tip trails. v19 fixed sharp/kinked contours (independent per-sample noise, differentiated for the ribbon's edge normals, was amplifying into visible zigzags) by switching wobble to a smooth per-wavelet sine (own frequency+phase, not per-sample noise). v20 gave tips real width (`WAKELET_TAPER_FLOOR` 0.6) instead of a sharp geometric point. v21 added highlight/shadow bands using `screen`/`multiply` blend modes (not flat source-over) so light reads as interacting with the scene — light source tied to each wavelet's own outward curvature (not a fixed world direction), colors pulled from the actual baked `nightSky.js` palette rather than invented, decided via a 3-question AskUserQuestion round. v22 replaced the flat fillStyle with a per-wavelet linear gradient (tip-to-tip, opaque middle → transparent over `WAKELET_TIP_FADE` 0.3 at each end) so tips fade into the background instead of ending in a crisp edge — one gradient object per wavelet per color, reused across every pass in that color (no new draw calls). v24 doubled length + placement/spread again (thickness left alone this time — clarified via AskUserQuestion since "size" was ambiguous after v16's thinning). v25 replaced the near-instant linear fade-in (4% of life) with an eased (`smoothstep`) build-in over ~22% of life, so wavelets build in gently rather than popping. Perf stayed bounded throughout: went from ~660 `drawImage` sprite blits/frame (pre-v12) to ~440 tiny-polygon `fill()` calls/frame (post-v21) plus gradient interpolation instead of flat blits (v22) — no shadowBlur, no new persistent layers, all per-wavelet randomness/gradients built once at spawn or once per wavelet per frame, never per-sample-per-frame. User directed the merge to main after this iteration series. **Open follow-ups, not yet addressed:** pace-reactivity, pause behavior; taper floor/highlight-shadow band width-shift-alpha/tip-fade fraction/fade-in fraction are first-pass numeric guesses that may still need dialing.
- 2026-07-10 — Hexagon + Triangle adopted Square's leash/bead tracing model (user request). Both previously re-projected the user bead with a GLOBAL nearest-point search every pointer-move event (event-driven), capping only the painted-stroke advance (`advanceAlongPath`, since removed) — so near a corner or the shape center the finger could snap the bead onto a DIFFERENT edge, and there was no freeze/drain when the finger strayed. Ported Square's model into each canvas (copied, not extracted to `_shared/` — decided via AskUserQuestion to keep the flagship untouched and blast radius small): module-level pure helpers `projectLocal`/`projectGlobal`/`arcGapPx`/`lerpCumLen`/`pointAt`/`fractionAt`, `LEASH_TRACK_WIDTHS 1.4` + `ACCEPTANCE_TRACK_WIDTHS 0.75` + `LAP_MIN_PROGRESS 0.15` constants, a `cumLen` array + `sides` added to `buildGeo`, and new refs `beadIdxRef`/`fingerPosRef`/`tracingRef`/`passedLapCheckpointRef`. Pointer handlers now only place the bead on first/re-touch (global projection + acceptance) and record the raw finger pos; the leash/acceptance gating + bead advance + corner-correct `paintBeadSegment` + lap-checkpoint detection run PER-FRAME in the rAF loop (decoupled from event rate), exactly like Square. `tracingRef` (attached-and-following this frame) replaces `touchRef` as the "touching" signal feeding the heat gauge (`isTooFast`/`isGoodPace`/`isTrulyRacing`) and synergy, so off-track/leash-snap now drains those systems. Each game's own pacing kept intact — Hexagon's non-uniform 4-4-2 `SIDE_DURATIONS_MS` gauge rate and Triangle's uniform 3-3-3 are untouched; `childPathRate` stays in the same fraction-units/ms the gauge already expects. Perf: the per-frame local projection is windowed to the leash arc (a handful of segments), strictly cheaper than the old whole-path global search that ran per event — zero new layers, no per-frame allocation beyond the existing stamp path. Removed now-dead `project`/`advanceAlongPath`/`checkLap`/`MAX_PATH_ADVANCE_MULT`/`lastMoveTimeRef`/`lastChildPos`. Build verified clean for both. **On-device feel confirm pending (leash forgiveness, freeze-on-stray, re-touch-anywhere) per the visual-verification workflow — Claude owns build/functional correctness only.**
- 2026-07-11 — Hexagon: sampled ambient bed added (user-provided `public/sounds/hexGameAmbience.mp3`, 2:12, 48kHz stereo — already committed to main pre-session), mirroring Square's `synthAmbient.js` technique via a new standalone `src/sound/synthHexAmbient.js` (crossfade-loop scheduling + Haas-effect widening; channel-difference check confirmed the file is effectively mono content in a stereo container, same as Square's bed, so the widening technique applies). Kept as a separate module rather than sharing/parametrizing `synthAmbient.js`, continuing this branch's established precedent of independent hex audio modules (`synthHexBreath.js` alongside `synthBreath.js`). Per user's explicit choice (asked via AskUserQuestion): the bed also ducks toward silence as the heat gauge climbs, mirroring `SoundDirector`'s dysregulation treatment of Square's bed — same constants (`gauge/0.9` ratio, floor 0, TC 0.10, reschedule eps 0.005), scoped down to just the bed's own gain node (no lowpass sweep, no breath duck, since Hexagon has no reverb/rumble/synergy modules to match). New `onGameStateTick({gaugeEffect})` prop on `HexagonCanvas`, fired once per frame right where the existing gauge-effect value is finalized; `useHexBreath` gained `updateGauge()` alongside the existing `unlock`/`update`/`fadeOut`, with the ambient bed on its own async-loaded, disposal-race-safe gain node so a fast unmount during the fetch/decode never leaks nodes. Peak gain matched to Square's 0.12 (user's choice). Zero new visual layers — audio only. Build verified clean. **On-device confirm pending: bed presence/level relative to the breath, and whether the gauge-ducking is felt as intended.**
- 2026-07-11 — Hexagon: breath masking fix (user report: "I can no longer hear the synth breathing audio" right after the ambient bed landed). No wiring bug found on re-audit — `onBreath` fires unconditionally every frame, structurally independent of the ambient bed's connections. Root cause instead: the hex breath is deliberately deep/brown-noise/heavily low-passed (300–560Hz, per an earlier session's explicit request), and low-frequency content reads as quieter than a broadband sampled ambient bed at "comparable" linear gain (equal-loudness contours) — the bed was burying it. Two fixes: (1) sidechain duck — `synthHexBreath.js`'s `update()` now returns its own bell envelope (0..1 presence, unscaled by peakGain); `useHexBreath.js` uses it to duck the ambient bed to `BED_BREATH_DUCK_FLOOR` (0.55) via a second gain node chained after the existing heat-gauge duck node (kept separate so the two never interfere with each other's throttling), TC 0.25s. (2) headroom bump — `deepBreath` mode's `peakGain` 0.16→0.26, lowpass ceiling opened 560/520→700/650Hz; same deep/brown-noise character, more level. Build verified clean. **On-device confirm pending — Claude cannot listen to verify audio; both the fix and the tuning constants (`BED_BREATH_DUCK_FLOOR`, `TC_BREATH_DUCK`, bumped `peakGain`) need an ears-on check.**
