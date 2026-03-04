import { loadStripe } from '@stripe/stripe-js'

// Stripe is loaded lazily — the promise resolves when the Stripe.js script loads.
// Always use test mode keys (pk_test_...) for MVP. Never hardcode keys.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
