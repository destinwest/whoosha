import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import useStore from './store/useStore'
import LoadingSpinner from './components/ui/LoadingSpinner'

import LandingPage from './pages/LandingPage'
import DemoPage from './pages/DemoPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import DashboardPage from './pages/DashboardPage'
import AccountPage from './pages/AccountPage'
import SquarePage from './pages/games/SquarePage'

// Wraps routes that require authentication.
// - Shows a loading screen while the initial auth check is in flight.
// - Redirects to /login if the user is not authenticated.
// - Redirects to /onboarding if the parent has no children yet.
function ProtectedRoute({ children }) {
  const user = useStore((state) => state.user)
  const loading = useStore((state) => state.loading)
  const childProfiles = useStore((state) => state.childProfiles)
  const location = useLocation()

  if (loading) return <LoadingSpinner />

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Already has children — don't let them back into onboarding.
  if (Array.isArray(childProfiles) && childProfiles.length > 0 && location.pathname === '/onboarding') {
    return <Navigate to="/home" replace />
  }

  // Onboarding gate: childProfiles is [] (not null) only after a successful
  // fetch, so this fires only when we know for certain there are no children.
  if (Array.isArray(childProfiles) && childProfiles.length === 0 && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return children
}

// Wraps routes that should not be accessible once logged in (login, signup).
// Redirects authenticated users to /home so they skip the auth screens.
function PublicRoute({ children }) {
  const user = useStore((state) => state.user)
  const loading = useStore((state) => state.loading)

  if (loading) return <LoadingSpinner />
  if (user) return <Navigate to="/home" replace />

  return children
}

// Separated from App so that useLocation (and useAuth) run inside BrowserRouter context.
function AppRoutes() {
  useAuth() // Initialize auth listener — must be called once at app root

  return (
    <Routes>
      {/* ── Public routes ─────────────────────────────────────── */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicRoute>
            <SignupPage />
          </PublicRoute>
        }
      />

      {/* ── Protected routes ──────────────────────────────────── */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/games/square"
        element={
          <ProtectedRoute>
            <SquarePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />

      {/* Fallback — redirect unknown paths to landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
