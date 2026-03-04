// Demo Page (/demo) — public interactive preview of Square Breathing.
// For MVP: stub with a banner pointing to sign up.
// Full implementation: post-MVP (see Section 5 of briefing).
export default function DemoPage() {
  return (
    <div className="min-h-screen bg-bg-mint flex flex-col items-center justify-center gap-3">
      <h1 className="font-display text-4xl font-semibold text-text-forest">Try Whoosha</h1>
      <p className="font-body text-lg text-text-sage">/demo · public</p>
      <p className="font-body text-sm text-text-sage mt-2">Interactive demo — coming soon</p>
    </div>
  )
}
