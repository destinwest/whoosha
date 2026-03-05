import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  // Capture 100% of traces in development; tune down for production
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
})

function ErrorFallback({ resetError }) {
  return (
    <div className="min-h-screen bg-bg-cream flex flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="font-display text-4xl font-semibold text-text-forest">
        Something went a little sideways 🌿
      </p>
      <p className="font-body text-text-sage max-w-xs">
        Don't worry — let's take a breath and try again.
      </p>
      <button
        onClick={resetError}
        className="font-body font-semibold text-sm bg-primary text-white px-6 py-3 rounded-full hover:opacity-90 transition-opacity"
      >
        Try again
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback resetError={resetError} />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
