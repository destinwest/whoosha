import { Link } from 'react-router-dom'

// Placeholder during private beta. Real content authored before public launch.
export default function TermsPage() {
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
          Terms of Service
        </h1>

        <div className="font-body text-text-sage space-y-5 leading-relaxed text-lg">
          <p>
            Whoosha is currently in private beta. A full Terms of Service
            agreement will be published before the product is offered to the
            general public.
          </p>
          <p>
            By using Whoosha during the beta period, you agree to use the
            product as intended — a tool to support breathing and nervous
            system regulation for children — and not to redistribute, resell,
            or reverse-engineer the application.
          </p>
          <p>
            Whoosha is not a medical device, not therapy, and not a substitute
            for professional mental health care. If your child is experiencing
            a serious crisis, please contact a qualified clinician or
            emergency services.
          </p>
          <p>
            The product is provided as-is during the beta period without
            warranty of fitness for a particular purpose.
          </p>
          <p>
            For questions during the beta period, reach out at{' '}
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
