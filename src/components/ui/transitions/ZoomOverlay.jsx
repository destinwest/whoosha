import { createPortal } from 'react-dom';

// Renders the zooming icon clone in a fixed portal above everything.
// GameCard drives the scale animation by writing to cloneRef directly —
// no React re-renders occur during animation.
export default function ZoomOverlay({ iconNode, originRect, cloneRef }) {
  return createPortal(
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 9999,
      overflow: 'hidden',
    }}>
      <div
        ref={cloneRef}
        style={{
          position: 'absolute',
          width:  originRect.width  + 'px',
          height: originRect.height + 'px',
          left:   originRect.left   + 'px',
          top:    originRect.top    + 'px',
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        {iconNode}
      </div>
    </div>,
    document.body,
  );
}
