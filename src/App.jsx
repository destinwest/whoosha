import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import useStore from './store/useStore'
import LoadingSpinner from './components/ui/LoadingSpinner'

import LandingPage from './pages/LandingPage'
import DemoPage from './pages/DemoPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import DashboardPage from './pages/DashboardPage'
import AccountPage from './pages/AccountPage'
import SquarePage from './pages/games/SquarePage'
import GameLaunch from './components/transitions/GameLaunch'
import DragonPage from './pages/games/DragonPage'
import HexagonPage from './pages/games/HexagonPage'

// ── TEMP: auth bypass ───────────────────────────────────────────────────────
// Supabase auth is unavailable (account disabled), so the normal login flow
// can't be used. While this flag is true:
//   • protected routes render WITHOUT authentication (no /login redirect,
//     no /onboarding gate), and
//   • "/" goes straight to /home instead of the marketing LandingPage.
// All protected pages are null-safe with no user (HomePage greets "Hi there",
// useSession.saveSession no-ops without an active child), so nothing crashes.
// To restore normal auth: set this to false (and ideally delete this block and
// the two `BYPASS_AUTH` checks below).
const BYPASS_AUTH = true

// Gates protected routes: requires authentication, and forces a first-time
// signup through /onboarding before any other protected route is reachable.
function ProtectedRoute({ children }) {
  // TEMP auth bypass — see BYPASS_AUTH above.
  if (BYPASS_AUTH) return children

  const user = useStore((state) => state.user)
  const loading = useStore((state) => state.loading)
  const childProfiles = useStore((state) => state.childProfiles)
  const location = useLocation()

  if (loading) return <LoadingSpinner />

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Children-fetch flicker guard: after a fresh login, setUser() resolves
  // before the children query does. During that ~50–300 ms window
  // childProfiles is still null. Without this guard the page would render
  // briefly with no profile data, then redirect to /onboarding once the
  // fetch completes. Show the spinner instead so the route gate is strict.
  if (childProfiles === null) return <LoadingSpinner />

  // Already has children — don't let them back into onboarding.
  if (childProfiles.length > 0 && location.pathname === '/onboarding') {
    return <Navigate to="/home" replace />
  }

  // Onboarding gate: childProfiles is [] only after a successful fetch
  // (guard above caught null), so this fires only when we know for certain
  // there are no children.
  if (childProfiles.length === 0 && location.pathname !== '/onboarding') {
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
      {/* TEMP auth bypass — "/" skips the landing page and goes to /home.
          Restore `<LandingPage />` when BYPASS_AUTH is turned off. */}
      <Route path="/" element={BYPASS_AUTH ? <Navigate to="/home" replace /> : <LandingPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
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
        path="/games/dragon"
        element={
          <ProtectedRoute>
            <DragonPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/games/hexagon"
        element={
          <ProtectedRoute>
            <HexagonPage />
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
      <GameLaunch />
    </BrowserRouter>
  )
}
