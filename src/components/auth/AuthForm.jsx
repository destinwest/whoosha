import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

// Google G SVG — matches official brand colors
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

// Shared auth card used by both LoginPage and SignupPage.
// On success, supabase.auth fires onAuthStateChange → useAuth in App.jsx
// hydrates the store → ProtectedRoute / PublicRoute handle the redirect.
// No manual navigation needed here.
export default function AuthForm({ mode }) {
  const isLogin = mode === 'login'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [emailSent, setEmailSent] = useState(false)

  async function handleGoogleOAuth() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // After OAuth redirect, Supabase returns the user to this origin.
        // Make sure this URL is listed in your Supabase project's
        // Authentication → URL Configuration → Redirect URLs.
        redirectTo: window.location.origin,
      },
    })
    if (error) setError(error.message)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(error.message)
        // Success: onAuthStateChange fires, store updates, PublicRoute redirects to /home
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          setError(error.message)
        } else if (data.user && !data.session) {
          // Email confirmation is enabled in Supabase — show the check-your-email state.
          // Disable email confirmation in Supabase dashboard for frictionless local testing.
          setEmailSent(true)
        }
        // If data.session exists (confirmation disabled), onAuthStateChange handles redirect.
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Email-sent confirmation state ─────────────────────────────────────────
  if (emailSent) {
    return (
      <div className="min-h-screen bg-bg-mint flex flex-col">
        <div className="p-6 flex-shrink-0">
          <Link to="/" className="font-display text-2xl font-semibold text-text-forest hover:text-primary transition-colors">
            Whoosha
          </Link>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md bg-bg-cream rounded-3xl shadow-lg px-10 py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h2 className="font-display text-2xl font-semibold text-text-forest mb-3">
              Check your email
            </h2>
            <p className="font-body text-text-sage leading-relaxed">
              We sent a confirmation link to{' '}
              <span className="font-semibold text-text-forest">{email}</span>.
              Click it to activate your account, then come back and log in.
            </p>
            <Link
              to="/login"
              className="inline-block mt-8 font-body font-semibold text-primary hover:underline"
            >
              Back to log in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Main auth form ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg-mint flex flex-col">

      {/* Logo — top left, links back to landing. No nav bar. */}
      <div className="p-6 flex-shrink-0">
        <Link
          to="/"
          className="font-display text-2xl font-semibold text-text-forest hover:text-primary transition-colors"
          aria-label="Whoosha — back to home"
        >
          Whoosha
        </Link>
      </div>

      {/* Centered card */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md bg-bg-cream rounded-3xl shadow-lg px-10 py-12">

          {/* Logo placeholder — replace with <img> when brand mark is ready */}
          <div className="flex justify-center mb-8" aria-hidden="true">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="font-display text-3xl font-semibold text-primary select-none">W</span>
            </div>
          </div>

          {/* Headline */}
          <h1 className="font-display text-3xl font-semibold text-text-forest text-center mb-8 leading-snug">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleOAuth}
            className="w-full flex items-center justify-center gap-3 bg-white border border-text-sage/30 rounded-xl py-3.5 font-body font-semibold text-text-forest hover:bg-bg-mint/50 active:bg-bg-mint transition-colors"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6" aria-hidden="true">
            <div className="flex-1 h-px bg-text-sage/25" />
            <span className="font-body text-sm text-text-sage">or</span>
            <div className="flex-1 h-px bg-text-sage/25" />
          </div>

          {/* Email + password form */}
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-text-sage/25 bg-white px-4 py-3.5 font-body text-base text-text-forest placeholder:text-text-sage/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
            </div>

            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                className="w-full rounded-xl border border-text-sage/25 bg-white px-4 py-3.5 font-body text-base text-text-forest placeholder:text-text-sage/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
            </div>

            {/* Error message */}
            {error && (
              <p role="alert" className="font-body text-sm text-red-600 text-center pt-1">
                {error}
              </p>
            )}

            {/* Primary action */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-white rounded-xl py-3.5 font-body font-semibold text-lg hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {submitting
                ? 'One moment...'
                : isLogin
                  ? 'Log In'
                  : 'Create Account'}
            </button>
          </form>
        </div>

        {/* Toggle link — below the card */}
        <p className="font-body text-text-sage mt-6 text-base text-center">
          {isLogin ? (
            <>
              Don&apos;t have an account?{' '}
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Log in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
