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
    document.documentElement.style.setProperty('--intro-scale', '1.09');

    // Wrap setTimeout so its cancel function lives in the same collection
    // as the RAF cancel functions. handleSkip can then cancel everything
    // in one call, even if it fires before a scheduled step has started.
    function wait(ms, fn) {
      const id = setTimeout(fn, ms);
      cancelFns.current.push(() => clearTimeout(id));
    }

    // Hold dark 700ms — linger in the space after the dive.

    // Step 1 — scale settles while still mostly dark (700ms)
    // Felt as the momentum of the dive decaying; done before the light arrives.
    wait(700, () => {
      const cancel = animVal(1.09, 1.0, 500, easeOutQuart, (v) => {
        document.documentElement.style.setProperty('--intro-scale', `${v.toFixed(4)}`);
      }, null);
      cancelFns.current.push(cancel);
    });

    // Step 2 — overlay fades (750ms) — light begins to emerge
    wait(750, () => {
      if (!overlayRef.current) return;
      overlayRef.current.style.transition =
        'opacity 1100ms cubic-bezier(0.4, 0, 0.2, 1)';
      overlayRef.current.style.opacity = '0';
    });

    // Step 3 — blur clears (800ms) — eyes adjust as light grows
    wait(800, () => {
      const cancel = animVal(8, 0, 1000, easeOutSoft, (v) => {
        document.documentElement.style.setProperty('--intro-blur', `${v.toFixed(2)}px`);
      }, null);
      cancelFns.current.push(cancel);
    });

    // onComplete after all three have landed (~1850ms total)
    wait(1900, () => {
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
