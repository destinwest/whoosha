import { useEffect, useRef } from 'react';

const easeOutSoft  = t => 1 - Math.pow(1 - t, 2);
const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

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

export default function FadeSettleIntro({ onComplete }) {
  const overlayRef   = useRef(null);
  const cancelsRef   = useRef([]);
  const timeoutsRef  = useRef([]);
  const doneRef      = useRef(false);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;

    // cancel all pending animation/timeout handles
    cancelsRef.current.forEach(fn => fn());
    timeoutsRef.current.forEach(id => clearTimeout(id));
    cancelsRef.current  = [];
    timeoutsRef.current = [];

    // reset custom properties
    document.documentElement.style.setProperty('--intro-blur',  '0px');
    document.documentElement.style.setProperty('--intro-scale', '1');

    onComplete?.();
  }

  function skip() {
    if (doneRef.current) return;
    // snap overlay out quickly
    if (overlayRef.current) {
      overlayRef.current.style.transition = 'opacity 250ms ease';
      overlayRef.current.style.opacity    = '0';
    }
    document.documentElement.style.setProperty('--intro-blur',  '0px');
    document.documentElement.style.setProperty('--intro-scale', '1');

    const t = setTimeout(finish, 250);
    timeoutsRef.current.push(t);
    // cancel all existing handles now so they don't fight
    cancelsRef.current.forEach(fn => fn());
    cancelsRef.current = [];
  }

  useEffect(() => {
    // set initial values
    document.documentElement.style.setProperty('--intro-blur',  '7px');
    document.documentElement.style.setProperty('--intro-scale', '1.05');

    // Step 1 — overlay fade (CSS transition, triggered once after 150ms)
    const t1 = setTimeout(() => {
      if (overlayRef.current) {
        overlayRef.current.style.transition =
          'opacity 1800ms cubic-bezier(0.4, 0, 0.2, 1)';
        overlayRef.current.style.opacity = '0';
      }
    }, 150);
    timeoutsRef.current.push(t1);

    // Step 2 — blur clears (RAF, starts at 1200ms)
    const t2 = setTimeout(() => {
      const cancel = animVal(7, 0, 1600, easeOutSoft, val => {
        document.documentElement.style.setProperty('--intro-blur', `${val}px`);
      });
      cancelsRef.current.push(cancel);
    }, 1200);
    timeoutsRef.current.push(t2);

    // Step 3 — scale settles (RAF, starts at 1500ms)
    const t3 = setTimeout(() => {
      const cancel = animVal(1.05, 1.0, 1400, easeOutQuart, val => {
        document.documentElement.style.setProperty('--intro-scale', `${val}`);
      });
      cancelsRef.current.push(cancel);
    }, 1500);
    timeoutsRef.current.push(t3);

    // Step 4 — onComplete at ~2900ms
    const t4 = setTimeout(() => {
      finish();
    }, 2900);
    timeoutsRef.current.push(t4);

    return () => {
      cancelsRef.current.forEach(fn => fn());
      timeoutsRef.current.forEach(id => clearTimeout(id));
      // reset on unmount in case onComplete hasn't fired
      document.documentElement.style.setProperty('--intro-blur',  '0px');
      document.documentElement.style.setProperty('--intro-scale', '1');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        pointerEvents: 'auto',
      }}
    >
      {/* dark overlay */}
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          background: '#2C4A3E',
          opacity: 1,
        }}
      />

      {/* skip glyph */}
      <button
        onClick={skip}
        aria-label="Skip intro"
        style={{
          position: 'absolute',
          bottom: 24,
          right: 28,
          zIndex: 11,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.35)',
          fontSize: 32,
          lineHeight: 1,
          fontFamily: 'serif',
          userSelect: 'none',
        }}
      >
        ›
      </button>
    </div>
  );
}
