import { createPortal } from 'react-dom';

// Renders the zooming icon clone in a fixed portal above everything.
// GameCard drives the animation by writing to cloneRef and bgRef directly —
// no React re-renders occur during animation.
export default function ZoomOverlay({ iconNode, originRect, cloneRef, bgRef, transformOrigin }) {
  return createPortal(
    <div
      ref={bgRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden',
        background: '#9FBFB4', // matches home screen — animated to #2C4A3E by GameCard
      }}
    >
      <div
        ref={cloneRef}
        style={{
          position: 'absolute',
          width:  originRect.width  + 'px',
          height: originRect.height + 'px',
          left:   originRect.left   + 'px',
          top:    originRect.top    + 'px',
          transformOrigin: transformOrigin ?? 'center center',
          willChange: 'transform',
        }}
      >
        {iconNode}
      </div>
    </div>,
    document.body,
  );
}
