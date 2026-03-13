import FadeSettleIntro from './variants/FadeSettleIntro';

export default function GameIntro({ variant = 'fadeSettle', onComplete }) {
  if (variant === 'fadeSettle') {
    return <FadeSettleIntro onComplete={onComplete} />;
  }
  // fail-safe: unknown variant, skip straight to game
  onComplete?.();
  return null;
}
