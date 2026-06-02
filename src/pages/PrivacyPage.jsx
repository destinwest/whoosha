import { Link } from 'react-router-dom'

// Placeholder during private beta. Real content authored before public launch.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg-cream flex flex-col">
      <div className="p-6 flex-shrink-0">
        <Link
          to="/"
          className="font-display text-2xl font-semibold text-text-forest hover:text-primary transition-colors"
        >
          Whoosha
        </Link>
      </div>

      <main className="flex-1 max-w-2xl mx-auto px-6 py-8 md:py-12">
        <h1 className="font-display text-4xl font-semibold text-text-forest mb-8">
          Privacy Policy
        </h1>

        <div className="font-body text-text-sage space-y-5 leading-relaxed text-lg">
          <p>
            Whoosha is currently in private beta. A full privacy policy will be
            published before the product is offered to the general public.
          </p>
          <p>
            In the meantime, here&apos;s what we want you to know: we collect only
            what we need to make the experience work. Parent email and account
            credentials for authentication. A child&apos;s first name only, for the
            in-app greeting. Session history (game played, duration, completion
            status). Nothing else.
          </p>
          <p>
            We do not sell data. We do not use your information for marketing
            beyond direct communication about your account or this product.
          </p>
          <p>
            If you have questions during the beta period, reach out at{' '}
            <span className="text-text-forest">[contact email forthcoming]</span>.
          </p>
        </div>

        <div className="mt-12">
          <Link
            to="/"
            className="font-body text-primary hover:underline"
          >
            ← Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}
