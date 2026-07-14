// ── sharedContext ──────────────────────────────────────────────────────────
// The app's single shared AudioContext, and the gesture-time unlock helper.
//
// One AudioContext for the app's lifetime, created lazily and reused by EVERY
// game's audio path (SoundDirector, useHexBreath, useStarVoice). Browsers cap
// AudioContexts per page (~4 on iOS Safari) and don't reliably release closed
// ones, so a fresh context per game-mount risks permanently breaking audio
// after a handful of entries — doubly so in dev, where StrictMode's
// mount→unmount→remount cycle creates two per entry. We create exactly one and
// SUSPEND (never close) it between games.
//
// unlockSharedAudioContext() must be called SYNCHRONOUSLY inside a user-
// gesture handler (pointerdown / click / touchstart) — the gesture credit is
// consumed at resume() call time, not at promise resolution. The home
// carousel's card-tap handler calls it, which is what lets a game open with
// an already-running context on iOS: everything the game starts at mount
// (ambient beds, intro clips) is audible immediately, no in-game touch needed.
// Direct URL loads never see a card tap, so each game also keeps its own
// first-touch unlock as the fallback.

let _sharedCtx = null

export function getSharedAudioContext() {
  if (!_sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext  // webkit prefix for older Safari
    _sharedCtx = new Ctx()
  }
  return _sharedCtx
}

// The iOS AudioSession engage trick: playing a one-sample silent buffer forces
// the audio session backing Web Audio to actually start producing output.
// Safe to call on a suspended context (the source just queues).
export function playSilentBuffer(ctx) {
  try {
    const buf    = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buf
    source.connect(ctx.destination)
    source.start(0)
  } catch (e) {
    // Older browsers may throw if the context is closed or buffer args are odd.
  }
}

// Call from inside a user-gesture handler. Idempotent and cheap — safe to call
// on every card tap. Checks `!== 'running'` (not `=== 'suspended'`) so the
// iOS-only 'interrupted' state is also driven back toward running.
export function unlockSharedAudioContext() {
  const ctx = getSharedAudioContext()
  playSilentBuffer(ctx)
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {})
  }
  return ctx
}
