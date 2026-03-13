import { useEffect } from 'react';

export default function FadeSettleIntro({ onComplete }) {
  useEffect(() => {
    // stub: complete immediately, no visual transition
    const t = setTimeout(() => onComplete?.(), 50);
    return () => clearTimeout(t);
  }, [onComplete]);

  return null;
}
