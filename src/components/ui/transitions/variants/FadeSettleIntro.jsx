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
    document.documentElement.style.setProperty('--intro-blur',  '7px');
    document.documentElement.style.setProperty('--intro-scale', '1.05');

    // Wrap setTimeout so its cancel function lives in the same collection
    // as the RAF cancel functions. handleSkip can then cancel everything
    // in one call, even if it fires before a scheduled step has started.
    function wait(ms, fn) {
      const id = setTimeout(fn, ms);
      cancelFns.current.push(() => clearTimeout(id));
    }

    // Step 1 — overlay color fade (CSS transition, triggered once)
    wait(150, () => {
      if (!overlayRef.current) return;
      overlayRef.current.style.transition =
        'opacity 1800ms cubic-bezier(0.4, 0, 0.2, 1)';
      overlayRef.current.style.opacity = '0';
    });

    // Step 2 — blur clears (RAF, starts at 1200ms)
    wait(1200, () => {
      const cancel = animVal(7, 0, 1600, easeOutSoft, (v) => {
        document.documentElement.style.setProperty('--intro-blur', `${v.toFixed(2)}px`);
      }, null);
      cancelFns.current.push(cancel);
    });

    // Step 3 — scale settles (RAF, starts at 1500ms), fires onComplete when done
    wait(1500, () => {
      const cancel = animVal(1.05, 1.0, 1400, easeOutQuart, (v) => {
        document.documentElement.style.setProperty('--intro-scale', `${v.toFixed(4)}`);
      }, () => {
        resetProps();
        onComplete?.();
      });
      cancelFns.current.push(cancel);
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
