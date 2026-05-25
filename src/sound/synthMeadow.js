// ── synthMeadow ────────────────────────────────────────────────────────────
// The defining sound layer of the regulated state — discrete breeze events
// that pass through the meadow on a Poisson schedule. Between events the
// meadow is silent (except for the room tone from synthAir). Each event is
// a self-contained micro-system that:
//
//   1. Approaches — bandpass-filtered pink noise rises in a smooth bell
//      envelope, panning from a random starting side toward the listener.
//   2. Peaks    — the breeze is closest; filter brightens (high-frequency
//      absorption decreases with proximity), several leaf-rustle bursts
//      spawn at jittered times during this window, each panned near the
//      breeze's current spatial position.
//   3. Departs  — envelope decays; pan continues across to the opposite
//      side; filter darkens; leaves trail off.
//
// Each event self-disposes via the buffer source's onended callback.
//
// The module exposes setActivity(0..1) so the director can suppress new
// events during dysregulation — the meadow "holds its breath" when the
// child's nervous system is dysregulated, then resumes once they recover.

// ── Scheduling ────────────────────────────────────────────────────────────
const MIN_GAP_S        = 4       // never less than this between events (silence floor)
const MEAN_GAP_S       = 22      // average gap (excluding the min) — gives ~5 events/min target rate
const INITIAL_DELAY_MS = 3500    // first event fires this long after start

// ── Event archetypes ──────────────────────────────────────────────────────
// Each event picks one archetype weighted by `weight`, then jitters its
// numeric parameters within the given ranges. Variation between events is
// critical — repeated identical events feel mechanical.
const EVENT_ARCHETYPES = [
  // Weak — a brief stirring, few leaves
  {
    weight: 60,
    durationS:    [4.5, 7],
    peakGain:     [0.07, 0.12],
    filterBase:   [500, 700],
    filterPeak:   [900, 1300],
    leafCount:    [1, 3],
    leafIntensity:[0.10, 0.22],
  },
  // Moderate — clear gust
  {
    weight: 30,
    durationS:    [6, 10],
    peakGain:     [0.13, 0.22],
    filterBase:   [550, 800],
    filterPeak:   [1100, 1600],
    leafCount:    [3, 6],
    leafIntensity:[0.18, 0.34],
  },
  // Strong — full gust through the trees
  {
    weight: 10,
    durationS:    [9, 14],
    peakGain:     [0.23, 0.34],
    filterBase:   [600, 900],
    filterPeak:   [1300, 1900],
    leafCount:    [4, 8],
    leafIntensity:[0.28, 0.48],
  },
]

const TOTAL_WEIGHT = EVENT_ARCHETYPES.reduce((s, a) => s + a.weight, 0)

function pickArchetype() {
  let r = Math.random() * TOTAL_WEIGHT
  for (const a of EVENT_ARCHETYPES) {
    r -= a.weight
    if (r <= 0) return a
  }
  return EVENT_ARCHETYPES[0]
}

function rand(a, b)   { return a + Math.random() * (b - a) }
function randInt(a, b) { return Math.floor(rand(a, b + 1)) }

// Inverse-CDF Poisson inter-arrival — exponentially distributed gap above
// the MIN_GAP_S floor. Mean = MIN_GAP_S + MEAN_GAP_S.
function nextGapSec() {
  return MIN_GAP_S + (-Math.log(Math.random() + 1e-9) * MEAN_GAP_S)
}

// ── spawnBreezeEvent ──────────────────────────────────────────────────────
// Creates and starts one self-contained breeze event. Returns nothing —
// the event manages its own lifetime via source.onended.
function spawnBreezeEvent(ctx, pinkBuffer, destination) {
  const archetype = pickArchetype()
  const duration  = rand(...archetype.durationS)
  const peakGain  = rand(...archetype.peakGain)
  const fBase     = rand(...archetype.filterBase)
  const fPeak     = rand(...archetype.filterPeak)
  const leafN     = randInt(...archetype.leafCount)
  const leafI     = rand(...archetype.leafIntensity)

  // Pan trajectory: start ±0.7 on one side, end ±0.7 on the other.
  // Some jitter so it's not always a straight diagonal.
  const startPan = (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 0.85)
  const endPan   = -Math.sign(startPan) * rand(0.4, 0.85)

  const now = ctx.currentTime

  // ── Source ──
  const source = ctx.createBufferSource()
  source.buffer = pinkBuffer
  source.loop = true
  // Random start offset → no two events have identical noise textures
  const sourceOffset = Math.random() * (pinkBuffer.duration - duration - 0.5)

  // ── Filter (bandpass, sweeping center) ──
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 0.6
  filter.frequency.setValueAtTime(fBase, now)
  filter.frequency.linearRampToValueAtTime(fPeak, now + duration * 0.45)
  filter.frequency.linearRampToValueAtTime(fBase, now + duration)

  // ── Envelope (smooth bell — asymmetric: slow approach, faster departure) ──
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, now)
  // Approach: 0 → peak over 45% of duration
  env.gain.linearRampToValueAtTime(peakGain, now + duration * 0.45)
  // Brief hold at peak (15% of duration) — gust dwells momentarily
  env.gain.linearRampToValueAtTime(peakGain * 0.95, now + duration * 0.60)
  // Departure: → 0 over remaining 40% of duration
  env.gain.linearRampToValueAtTime(0, now + duration)

  // ── Pan (linear sweep across the field) ──
  const panner = ctx.createStereoPanner()
  panner.pan.setValueAtTime(startPan, now)
  panner.pan.linearRampToValueAtTime(endPan, now + duration)

  source.connect(filter).connect(env).connect(panner).connect(destination)
  source.start(now, sourceOffset)
  // Stop slightly after envelope ends to ensure the tail isn't audibly cut
  source.stop(now + duration + 0.1)

  // ── Leaves (spawned during the peak window — physically coupled) ──
  // Leaves can fire from roughly the 25%–80% portion of the event, with
  // density correlated to leafN. Each burst inherits the breeze's
  // approximate pan at trigger time, with a small spread for naturalism.
  for (let i = 0; i < leafN; i++) {
    const t = rand(0.25, 0.80)                              // normalized event time
    const burstStart = now + duration * t
    spawnLeafBurst(ctx, pinkBuffer, destination, burstStart, leafI, lerpPan(startPan, endPan, t))
  }

  // ── Cleanup ──
  source.onended = () => {
    try { source.disconnect() } catch (e) {}
    try { filter.disconnect()  } catch (e) {}
    try { env.disconnect()     } catch (e) {}
    try { panner.disconnect()  } catch (e) {}
  }
}

function lerpPan(a, b, t) {
  // Plus small jitter so leaves don't sit exactly on the breeze's pan line.
  return a + (b - a) * t + (Math.random() - 0.5) * 0.25
}

// ── spawnLeafBurst ────────────────────────────────────────────────────────
// One short rustle. High-passed pink-noise blip with a fast attack and short
// decay. Center frequency varies per burst so some sound like leaves (higher)
// and some like grass (lower) — adds organic variety.
function spawnLeafBurst(ctx, pinkBuffer, destination, startTime, peakIntensity, panValue) {
  const durMs = 90 + Math.random() * 220
  const durS  = durMs / 1000
  const attackS  = 0.025
  const releaseS = 0.18
  const totalS   = attackS + durS + releaseS

  // Highpass frequency randomized — 1.8 kHz (grass-ish) to 5 kHz (leaf-ish)
  const hpFreq   = 1800 + Math.random() * 3200
  const peak     = peakIntensity * (0.65 + Math.random() * 0.5)
  const sourceOffset = Math.random() * (pinkBuffer.duration - totalS - 0.1)

  const source = ctx.createBufferSource()
  source.buffer = pinkBuffer

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = hpFreq
  hp.Q.value = 0.7

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, startTime)
  env.gain.linearRampToValueAtTime(peak, startTime + attackS)
  env.gain.linearRampToValueAtTime(0, startTime + attackS + durS + releaseS)

  const panner = ctx.createStereoPanner()
  panner.pan.value = Math.max(-1, Math.min(1, panValue))

  source.connect(hp).connect(env).connect(panner).connect(destination)
  source.start(startTime, sourceOffset, totalS + 0.05)

  source.onended = () => {
    try { source.disconnect() } catch (e) {}
    try { hp.disconnect()     } catch (e) {}
    try { env.disconnect()    } catch (e) {}
    try { panner.disconnect() } catch (e) {}
  }
}

// ── createMeadow ──────────────────────────────────────────────────────────
// Public entry point. Returns the standard module shape: { output, setActivity, dispose }
//   activity ∈ [0, 1]:
//     1.0 → normal event spawn rate
//     0.0 → no new events spawn (in-flight events finish naturally)
//   The director maps this from (1 - gaugeEffect) so under full dysregulation
//   the meadow "holds its breath."
export function createMeadow(ctx, pinkBuffer) {
  const output = ctx.createGain()
  output.gain.value = 1

  let disposed = false
  let timeoutId = null
  let activity  = 1   // scales the spawn rate

  function scheduleNext() {
    if (disposed) return
    // Activity scales the gap — when activity drops, gaps lengthen.
    // Below activity = 0.15 we effectively stop spawning entirely.
    if (activity < 0.15) {
      timeoutId = setTimeout(scheduleNext, 2000)  // poll every 2s for activity recovery
      return
    }
    const gapS = nextGapSec() / activity
    timeoutId = setTimeout(() => {
      if (!disposed && activity >= 0.15) {
        spawnBreezeEvent(ctx, pinkBuffer, output)
      }
      scheduleNext()
    }, gapS * 1000)
  }

  timeoutId = setTimeout(scheduleNext, INITIAL_DELAY_MS)

  return {
    output,
    setActivity(value) {
      activity = Math.max(0, Math.min(1, value))
    },
    dispose() {
      disposed = true
      if (timeoutId) clearTimeout(timeoutId)
      try { output.disconnect() } catch (e) {}
      // In-flight nodes will self-clean via their own onended handlers.
    },
  }
}
