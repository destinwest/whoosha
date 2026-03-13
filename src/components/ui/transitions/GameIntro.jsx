import FadeSettleIntro from './variants/FadeSettleIntro';

const variants = {
  fadeSettle: FadeSettleIntro,
};

export default function GameIntro({ variant = 'fadeSettle', onComplete }) {
  const IntroVariant = variants[variant];

  if (!IntroVariant) {
    // fail-safe: unknown variant never blocks the game
    onComplete?.();
    return null;
  }

  return <IntroVariant onComplete={onComplete} />;
}
