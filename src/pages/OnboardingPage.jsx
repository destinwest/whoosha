import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import useStore from '../store/useStore'

export default function OnboardingPage() {
  const user = useStore((state) => state.user)
  const setChildProfiles = useStore((state) => state.setChildProfiles)
  const setActiveChild = useStore((state) => state.setActiveChild)

  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) return

    setError(null)
    setSubmitting(true)

    try {
      const { data, error } = await supabase
        .from('children')
        .insert({ parent_id: user.id, first_name: trimmedName })
        .select('id, first_name')
        .single()

      if (error) {
        setError('Something went a little sideways. Let\'s try again.')
        return
      }

      // Update the store immediately so ProtectedRoute sees children.length > 0
      // before we navigate — prevents a redirect loop back to /onboarding.
      setChildProfiles([data])
      setActiveChild(data)

      navigate('/home', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-mint flex flex-col">

      {/* Logo — top center, links to landing. No navigation. */}
      <div className="pt-8 flex justify-center flex-shrink-0">
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

          {/* Headline */}
          <h1 className="font-display text-3xl font-semibold text-text-forest text-center leading-snug mb-10">
            Who are we breathing with today?
          </h1>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">

            {/* Name input — large and rounded, tablet-friendly */}
            <div>
              <label htmlFor="child-name" className="sr-only">
                Child's first name
              </label>
              <input
                id="child-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Child's first name"
                required
                autoComplete="off"
                autoCapitalize="words"
                autoFocus
                maxLength={50}
                className="w-full rounded-2xl border border-text-sage/25 bg-white px-5 py-4 font-body text-xl text-text-forest placeholder:text-text-sage/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
            </div>

            {/* Privacy note */}
            <p className="font-body text-sm text-text-sage text-center px-2">
              We only store their first name. Nothing else.
            </p>

            {/* Error */}
            {error && (
              <p role="alert" className="font-body text-sm text-red-600 text-center">
                {error}
              </p>
            )}

            {/* Continue button */}
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="w-full bg-primary text-white rounded-xl py-4 font-body font-semibold text-lg hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-3"
            >
              {submitting ? 'One moment...' : 'Continue'}
            </button>

          </form>
        </div>
      </div>

    </div>
  )
}
