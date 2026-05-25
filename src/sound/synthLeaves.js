// ── synthLeaves ────────────────────────────────────────────────────────────
// Sparse high-frequency rustles — short noise bursts triggered on a
// Poisson-distributed schedule (~4 events per minute by default). Each burst
// is a fresh BufferSourceNode through a one-shot envelope and a random
// stereo position; nodes self-dispose via onended after playback.
//
// Poisson scheduling (vs. fixed interval) is critical for naturalism:
//   - Fixed intervals sound mechanical/percussive
//   - Poisson creates clusters and gaps that mirror real rustling
//
// Each burst is built from pink noise — the same shared buffer the breeze
// uses — but offset at a random start point and gated with a fast envelope.

const LAMBDA_PER_SEC     = 4 / 60           // average events per second
const BURST_DUR_MIN_MS   = 80
const BURST_DUR_MAX_MS   = 250
const HIGHPASS_FREQ      = 3000
const HIGHPASS_Q         = 0.7
const ATTACK_S           = 0.03
const RELEASE_S          = 0.20
const BURST_PEAK_GAIN    = 0.25
const OUTPUT_GAIN        = 0.65             // amplifies the (already-quiet) bursts

// Inverse-CDF Poisson inter-arrival: -ln(U)/λ.
function nextDelaySec() {
  return -Math.log(Math.random() + 1e-9) / LAMBDA_PER_SEC
}

export function createLeaves(ctx, pinkBuffer) {
  const output = ctx.createGain()
  output.gain.value = OUTPUT_GAIN

  let disposed = false
  let timeoutId = null
  const activeNodes = new Set()  // track in-flight bursts for cleanup on dispose

  // ── triggerBurst ──
  // Schedules and plays one rustle event. Self-cleans via onended.
  function triggerBurst() {
    if (disposed) return

    const burstDurMs = BURST_DUR_MIN_MS + Math.random() * (BURST_DUR_MAX_MS - BURST_DUR_MIN_MS)
    const burstDurS  = burstDurMs / 1000
    const startOffset = Math.random() * (pinkBuffer.duration - burstDurS - 0.1)
    const peak       = BURST_PEAK_GAIN * (0.6 + Math.random() * 0.4)  // amplitude variation
    const panValue   = (Math.random() - 0.5) * 1.6                    // ±0.8 stereo spread

    const source = ctx.createBufferSource()
    source.buffer = pinkBuffer
    // loop=false; one-shot

    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = HIGHPASS_FREQ
    hp.Q.value = HIGHPASS_Q

    const env = ctx.createGain()
    env.gain.value = 0

    const panner = ctx.createStereoPanner()
    panner.pan.value = panValue

    source.connect(hp).connect(env).connect(panner).connect(output)

    const now = ctx.currentTime
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(peak, now + ATTACK_S)
    env.gain.linearRampToValueAtTime(0, now + ATTACK_S + burstDurS + RELEASE_S)

    source.start(now, startOffset, ATTACK_S + burstDurS + RELEASE_S + 0.05)

    activeNodes.add(source)
    source.onended = () => {
      activeNodes.delete(source)
      try { source.disconnect() } catch (e) {}
      try { hp.disconnect()    } catch (e) {}
      try { env.disconnect()    } catch (e) {}
      try { panner.disconnect() } catch (e) {}
    }
  }

  // ── scheduleNext ──
  // Recursively schedules subsequent bursts via setTimeout. setTimeout is
  // adequate here because the human-perceptual jitter on a 4-per-minute event
  // is invisible — we don't need audio-thread accuracy.
  function scheduleNext() {
    if (disposed) return
    const delayMs = nextDelaySec() * 1000
    timeoutId = setTimeout(() => {
      triggerBurst()
      scheduleNext()
    }, delayMs)
  }

  // Kick off the schedule with a small initial delay so the first rustle
  // doesn't fire the instant the game starts.
  timeoutId = setTimeout(scheduleNext, 2000 + Math.random() * 3000)

  return {
    output,
    dispose() {
      disposed = true
      if (timeoutId) clearTimeout(timeoutId)
      activeNodes.forEach((node) => { try { node.stop() } catch (e) {} })
      activeNodes.clear()
      try { output.disconnect() } catch (e) {}
    },
  }
}
