import { useEffect, useRef } from 'react';

// ── Easing ─────────────────────────────────────────────────────────────────
const easeOutSoft  = t => 1 - Math.pow(1 - t, 2);
const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

// ── animVal ────────────────────────────────────────────────────────────────
// Interpolates from → to over duration ms using the given easing function.
// Calls onTick(value) each frame. Calls onDone() when complete.
// Returns a cancel function.
function animVal(from, to, duration, ease, onTick, onDone) {
  const start = performance.now();
  let handle;
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = ease(t);
    onTick(from + (to - from) * e);
    if (t < 1) {
      handle = requestAnimationFrame(tick);
    } else {
      onTick(to);
      onDone?.();
    }
  }
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}

// ── FadeSettleIntro ────────────────────────────────────────────────────────
export default function FadeSettleIntro({ onComplete }) {
  const overlayRef = useRef(null);
  // Single collection for all cancel functions — both timeouts and RAF handles.
  // handleSkip and useEffect cleanup both drain this same array, so neither
  // can leave a rogue animation or timeout running after the other fires.
  const cancelFns = useRef([]);

  function resetProps() {
    document.documentElement.style.setProperty('--intro-blur',  '0px');
    document.documentElement.style.setProperty('--intro-scale', '1');
    document.documentElement.style.setProperty('--intro-y',     '0px');
  }

  function cancelAll() {
    cancelFns.current.forEach(fn => fn());
    cancelFns.current = [];
  }

  function handleSkip() {
    cancelAll();
    resetProps();
    if (overlayRef.current) {
      overlayRef.current.style.transition = 'opacity 250ms ease';
      overlayRef.current.style.opacity    = '0';
    }
    // This final timeout is intentionally short and not cancel-tracked —
    // once skip fires, the overlay fade is the last thing happening and
    // onComplete fires 10ms after it ends.
    setTimeout(() => onComplete?.(), 260);
  }

  useEffect(() => {
    document.documentElement.style.setProperty('--intro-blur',  '8px');
    document.documentElement.style.setProperty('--intro-scale', '0.96');
    document.documentElement.style.setProperty('--intro-y',     '-12px');

    // Wrap setTimeout so its cancel function lives in the same collection
    // as the RAF cancel functions. handleSkip can then cancel everything
    // in one call, even if it fires before a scheduled step has started.
    function wait(ms, fn) {
      const id = setTimeout(fn, ms);
      cancelFns.current.push(() => clearTimeout(id));
    }

    // Hold dark 700ms — linger in the space after the dive.

    // Step 1 — overlay fades (750ms) — light begins to emerge
    wait(750, () => {
      if (!overlayRef.current) return;
      overlayRef.current.style.transition =
        'opacity 1100ms cubic-bezier(0.4, 0, 0.2, 1)';
      overlayRef.current.style.opacity = '0';
    });

    // Step 2 — blur clears + world drifts into position (800ms)
    // Both use the same easing so they read as a single "eyes adjusting" sensation.
    wait(800, () => {
      const cancelBlur = animVal(8, 0, 1000, easeOutSoft, (v) => {
        document.documentElement.style.setProperty('--intro-blur', `${v.toFixed(2)}px`);
      }, null);
      cancelFns.current.push(cancelBlur);

      const cancelY = animVal(-12, 0, 1000, easeOutSoft, (v) => {
        document.documentElement.style.setProperty('--intro-y', `${v.toFixed(2)}px`);
      }, null);
      cancelFns.current.push(cancelY);
    });

    // Step 3 — scale approaches (1050ms) — world arrives at correct distance,
    // visible in the partially-lit overlay window (A: 0.96→1.0, C: timed late)
    wait(1050, () => {
      const cancel = animVal(0.96, 1.0, 500, easeOutQuart, (v) => {
        document.documentElement.style.setProperty('--intro-scale', `${v.toFixed(4)}`);
      }, null);
      cancelFns.current.push(cancel);
    });

    // onComplete after all three have landed (~1850ms total)
    wait(1950, () => {
      resetProps();
      onComplete?.();
    });

    return () => {
      cancelAll();
      resetProps();
    };
  }, [onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
      {/* dark forest green overlay */}
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          background: '#2C4A3E',
          opacity: 1,
          pointerEvents: 'none',
        }}
      />
      {/* skip affordance */}
      <div
        onClick={handleSkip}
        style={{
          position: 'absolute',
          bottom: 16,
          right: 20,
          fontSize: 18,
          color: 'rgba(255,255,255,0.25)',
          cursor: 'pointer',
          pointerEvents: 'auto',
          userSelect: 'none',
          zIndex: 11,
          lineHeight: 1,
        }}
      >
        ›
      </div>
    </div>
  );
}
