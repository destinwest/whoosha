import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// ── Demo animation — module-level helpers (pure, no component deps) ───────────

const DEMO_BASE_COLOR = '#F5EFE6'                                     // cream — untraced path
const DEMO_LAP_COLORS = ['#7DB89A', '#5B9FAA', '#9B8FC4', '#8BA7C7'] // matches game lap sequence
const DEMO_CYCLE_MS   = 16_000
const DEMO_LABELS     = ['Breathe in', 'Hold', 'Breathe out', 'Hold']

function demoBuildGeo(rect) {
  const w    = rect.width
  const h    = rect.height
  const sq   = Math.min(w, h) * 0.70
  const cx   = w / 2
  const cy   = h / 2
  const half = sq / 2
  const lw   = sq * 0.055
  return {
    corners: [
      { x: cx - half, y: cy + half }, // 0: BL
      { x: cx + half, y: cy + half }, // 1: BR
      { x: cx + half, y: cy - half }, // 2: TR
      { x: cx - half, y: cy - half }, // 3: TL
    ],
    cx, cy, sq, lw,
  }
}

function demoGetDot(elapsed, geo) {
  const { corners } = geo
  const frac = ((elapsed % DEMO_CYCLE_MS) / DEMO_CYCLE_MS) * 4
  const seg  = Math.floor(frac) % 4
  const t    = frac % 1
  const a    = corners[seg]
  const b    = corners[(seg + 1) % 4]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, seg, segT: t }
}

// ── SquareBreatheDemo ─────────────────────────────────────────────────────────
// Auto-playing canvas animation — no user input, clicking navigates to /demo.
// Painting mechanic mirrors the real game: path starts cream, dot paints in
// the current lap color behind it. After all 4 lap colors, resets to cream.

function SquareBreatheDemo() {
  const canvasRef   = useRef(null)
  const rafRef      = useRef(null)
  const geoRef      = useRef(null)
  const startRef    = useRef(0)
  const paintRef    = useRef(null)  // off-screen canvas — persistent paint across frames
  const lapIdxRef   = useRef(0)     // index into DEMO_LAP_COLORS
  const lapCountRef = useRef(0)     // total laps elapsed, used to detect lap boundaries
  const prevDotRef  = useRef(null)  // previous dot position for paint segments

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    const paintCanvas = document.createElement('canvas')
    paintRef.current  = paintCanvas

    function resize() {
      const dpr  = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr
      paintCanvas.width  = rect.width  * dpr
      paintCanvas.height = rect.height * dpr
      geoRef.current     = demoBuildGeo(rect)
      prevDotRef.current = null  // avoid segment across resized geometry
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function frame() {
      rafRef.current = requestAnimationFrame(frame)
      const geo = geoRef.current
      if (!geo) return

      const dpr     = window.devicePixelRatio || 1
      const W       = canvas.width  / dpr
      const H       = canvas.height / dpr
      const { corners, cx, cy, lw, sq } = geo
      const now     = performance.now()
      const elapsed = now - startRef.current
      const dot     = demoGetDot(elapsed, geo)

      // ── Lap boundary detection ─────────────────────────────────────────────
      // One lap = one full DEMO_CYCLE_MS. After every 4th lap, reset paint
      // canvas and restart from cream for a seamless looping demonstration.
      const totalLaps = Math.floor(elapsed / DEMO_CYCLE_MS)
      if (totalLaps > lapCountRef.current) {
        lapCountRef.current = totalLaps
        if (totalLaps % DEMO_LAP_COLORS.length === 0) {
          // Completed a full 4-lap cycle — clear paint canvas, restart cream
          const pCtx = paintCanvas.getContext('2d')
          pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height)
        }
        lapIdxRef.current  = totalLaps % DEMO_LAP_COLORS.length
        prevDotRef.current = null  // don't paint a segment across the lap boundary
      }

      // ── Paint dot trail on off-screen canvas ──────────────────────────────
      const prev = prevDotRef.current
      if (prev) {
        const pCtx = paintCanvas.getContext('2d')
        pCtx.save()
        pCtx.scale(dpr, dpr)
        pCtx.beginPath()
        pCtx.moveTo(prev.x, prev.y)
        pCtx.lineTo(dot.x, dot.y)
        pCtx.strokeStyle = DEMO_LAP_COLORS[lapIdxRef.current]
        pCtx.lineWidth   = lw
        pCtx.lineCap     = 'round'
        pCtx.stroke()
        pCtx.restore()
      }
      prevDotRef.current = { x: dot.x, y: dot.y }

      // ── Draw frame ────────────────────────────────────────────────────────
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // Background fill — eucalyptus sage matches the actual game canvas
      ctx.fillStyle = '#9FBFB4'
      ctx.fillRect(0, 0, W, H)

      // 1. Cream base path — the untraced state
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        if (i === 0) ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.closePath()
      ctx.strokeStyle = DEMO_BASE_COLOR
      ctx.lineWidth   = lw
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.stroke()

      // 2. Paint layer — permanent traces painted by the dot
      ctx.drawImage(paintCanvas, 0, 0, W, H)

      // 3. Dot glow
      const grd = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, lw * 1.5)
      grd.addColorStop(0, 'rgba(212,160,86,0.4)')
      grd.addColorStop(1, 'rgba(212,160,86,0)')
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, lw * 1.5, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()

      // 4. Dot
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, lw * 0.65, 0, Math.PI * 2)
      ctx.fillStyle = '#D4A056'
      ctx.fill()

      // 5. Phase label — fades in/out with side progress
      const { seg, segT } = dot
      const labelAlpha = segT < 0.15 ? segT / 0.15 : segT > 0.85 ? (1 - segT) / 0.15 : 1

      const sA  = corners[seg]
      const sB  = corners[(seg + 1) % 4]
      const mx  = (sA.x + sB.x) / 2
      const my  = (sA.y + sB.y) / 2
      const dxC = cx - mx
      const dyC = cy - my
      const d   = Math.hypot(dxC, dyC)
      const lx  = mx + (dxC / d) * lw * 2.8
      const ly  = my + (dyC / d) * lw * 2.8

      ctx.save()
      ctx.globalAlpha = labelAlpha * 0.72
      ctx.translate(lx, ly)
      if (seg === 1) ctx.rotate(Math.PI / 2)
      if (seg === 3) ctx.rotate(-Math.PI / 2)
      ctx.font         = `600 ${Math.max(11, sq * 0.052)}px 'Nunito', sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle    = '#3E5E52'
      ctx.fillText(DEMO_LABELS[seg], 0, 0)
      ctx.restore()

      ctx.restore()
    }

    // Wait for fonts before first draw so text renders with the correct typeface
    document.fonts.ready.then(() => {
      startRef.current = performance.now()
      rafRef.current   = requestAnimationFrame(frame)
    })

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      aria-label="Square breathing demo — a dot traces a colorful square with breathing cues on each side"
    />
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function WindIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  )
}

function CheckIcon() {
  // Inherits color from parent element via currentColor
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
      <path fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0 text-text-sage/40">
      <path fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" className="w-6 h-6">
      <line x1="3" y1="6"  x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" className="w-6 h-6">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Parents',  href: '#for-parents'  },
  { label: 'Pricing',      href: '#pricing'       },
]

function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-bg-cream/95 backdrop-blur-sm border-b border-text-forest/10">
      <nav className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link
          to="/"
          className="font-display text-2xl font-semibold text-text-forest hover:text-primary transition-colors flex-shrink-0"
        >
          Whoosha
        </Link>

        {/* Desktop center links */}
        <ul className="hidden md:flex items-center gap-8 flex-1 justify-center">
          {NAV_LINKS.map(link => (
            <li key={link.href}>
              <a
                href={link.href}
                className="font-body text-base text-text-sage hover:text-text-forest transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Desktop auth buttons */}
        <div className="hidden md:flex items-center gap-3 flex-shrink-0">
          <Link
            to="/login"
            className="font-body text-base font-medium text-text-sage hover:text-text-forest transition-colors px-2"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="font-body text-base font-semibold bg-primary text-white px-5 py-2.5 rounded-xl hover:bg-primary/90 active:bg-primary/80 transition-colors"
          >
            Sign Up
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-text-forest p-1 -mr-1 rounded-lg hover:bg-text-forest/5 transition-colors"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-text-forest/10 bg-bg-cream px-5 py-4 flex flex-col gap-4">
          {NAV_LINKS.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="font-body text-lg text-text-sage hover:text-text-forest transition-colors"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <hr className="border-text-forest/10" />
          <Link to="/login"  className="font-body text-lg text-text-sage hover:text-text-forest transition-colors" onClick={() => setOpen(false)}>Log in</Link>
          <Link to="/signup" className="font-body text-lg font-semibold bg-primary text-white text-center py-3 rounded-xl hover:bg-primary/90 transition-colors" onClick={() => setOpen(false)}>Sign Up Free</Link>
        </div>
      )}
    </header>
  )
}

// ── Hero Section ──────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-24 lg:py-28 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

      {/* Left: copy */}
      <div className="flex-1 text-center lg:text-left">
        {/* TODO: Replace with final brand tagline */}
        <h1 className="font-display text-5xl md:text-6xl font-semibold text-text-forest leading-tight mb-6">
          Calm breathing,<br />
          <span className="text-primary">designed for kids</span>
        </h1>
        {/* TODO: Replace with final subheadline */}
        <p className="font-body text-xl text-text-sage leading-relaxed mb-8 max-w-lg mx-auto lg:mx-0">
          Interactive breathing games that help children find calm — anywhere, anytime. No instructions needed. Just trace and breathe.
        </p>
        <Link
          to="/signup"
          className="inline-block font-body font-semibold text-lg bg-primary text-white px-8 py-4 rounded-2xl hover:bg-primary/90 active:bg-primary/80 transition-colors shadow-sm"
        >
          Get started free
        </Link>
        <p className="font-body text-sm text-text-sage/70 mt-3">
          No credit card required
        </p>
      </div>

      {/* Right: demo animation */}
      <div className="w-full max-w-xs sm:max-w-sm lg:max-w-md flex-shrink-0">
        <Link to="/demo" className="block group">
          <div className="relative aspect-square w-full rounded-3xl bg-bg-mint/60 overflow-hidden shadow-md ring-1 ring-text-forest/8 group-hover:shadow-lg transition-shadow">
            <SquareBreatheDemo />
          </div>
          <p className="font-body text-sm text-text-sage/70 text-center mt-3 group-hover:text-text-sage transition-colors">
            Tap to try it yourself →
          </p>
        </Link>
      </div>

    </section>
  )
}

// ── Science Section ───────────────────────────────────────────────────────────

function ScienceSection() {
  return (
    <section
      id="how-it-works"
      className="bg-bg-rose py-20 md:py-28"
    >
      <div className="max-w-2xl mx-auto px-5 sm:px-6 text-center">
        {/* TODO: Replace with final section headline */}
        <h2 className="font-display text-4xl md:text-5xl font-semibold text-text-forest mb-12">
          Why it works
        </h2>

        <div className="flex flex-col gap-7 text-left">
          {/* TODO: Replace with science-backed copy reviewed by a therapist or researcher */}
          <p className="font-body text-lg text-text-sage leading-relaxed">
            When a child is overwhelmed, their nervous system shifts into fight-or-flight. Heart rate
            climbs, breathing becomes shallow, and the thinking brain goes offline. Telling a child
            to "just breathe" rarely works in that moment — they can't easily self-regulate through
            words alone.
          </p>
          {/* TODO: Replace with final research paragraph */}
          <p className="font-body text-lg text-text-sage leading-relaxed">
            Research shows that combining gentle tactile input with geometric tracing and paced
            breathwork creates a powerful neurological interrupt. It activates the parasympathetic
            nervous system — the body's built-in calm response — in a way that instructions cannot.
            The technique is used by occupational therapists, pediatric psychologists, and mindfulness
            educators worldwide.
          </p>
          {/* TODO: Replace with final closing paragraph */}
          <p className="font-body text-lg text-text-sage leading-relaxed">
            Whoosha delivers this evidence-based approach through a format children naturally engage
            with: a simple, beautiful game. No adult coaching required. No instructions to follow.
            Just a shape to trace, and a breath to follow.
          </p>
        </div>
      </div>
    </section>
  )
}

// ── Features Section ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    Icon: WindIcon,
    // TODO: Replace with final feature headline
    title: 'Designed for big feelings',
    // TODO: Replace with final feature description
    body: 'Built for children who are overwhelmed, not calm. Zero instructions, zero cognitive load — just an intuitive game that meets them where they are.',
    bg: 'bg-secondary/15',
    iconColor: 'text-secondary',
  },
  {
    Icon: ShieldIcon,
    // TODO: Replace with final feature headline
    title: 'Parent-ready',
    // TODO: Replace with final feature description
    body: 'Set up once, hand it over. Whoosha works independently — so you can help without having to be the one doing all the calming.',
    bg: 'bg-primary/15',
    iconColor: 'text-primary',
  },
  {
    Icon: LeafIcon,
    // TODO: Replace with final feature headline
    title: 'Grounded in science',
    // TODO: Replace with final feature description
    body: 'Box breathing and nervous system regulation techniques proven effective for children ages 5–12. Therapeutic intent built into every design decision.',
    bg: 'bg-accent-amber/20',
    iconColor: 'text-accent-amber',
  },
]

function FeatureCard({ Icon, title, body, bg, iconColor }) {
  return (
    <div className={`${bg} rounded-3xl p-8 flex flex-col gap-4`}>
      <span className={`${iconColor}`}>
        <Icon />
      </span>
      <h3 className="font-display text-2xl font-semibold text-text-forest leading-snug">
        {title}
      </h3>
      <p className="font-body text-base text-text-sage leading-relaxed">
        {body}
      </p>
    </div>
  )
}

function FeaturesSection() {
  return (
    <section id="for-parents" className="py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <h2 className="font-display text-4xl md:text-5xl font-semibold text-text-forest text-center mb-14">
          {/* TODO: Replace with final section headline */}
          Everything parents need
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing Section ───────────────────────────────────────────────────────────

const FREE_FEATURES = [
  { label: 'Square Breathing game',         included: true  },
  { label: '1 child profile',               included: true  },
  { label: 'Session history (last 7 days)', included: true  },
  { label: 'Infinity, Hexagon & Flower games', included: false },
  { label: 'Full history + progress charts',   included: false },
  { label: 'Up to 5 child profiles',           included: false },
]

const PAID_FEATURES = [
  { label: 'All 4 breathing games',         included: true },
  { label: 'Up to 5 child profiles',        included: true },
  { label: 'Full history + progress charts',included: true },
  { label: 'Session history (last 7 days)', included: true },
  { label: 'Square Breathing game',         included: true },
  { label: 'Everything in Free',            included: true },
]

function PricingCard({ title, price, priceNote, features, cta, ctaTo, highlight }) {
  return (
    <div className={[
      'rounded-3xl p-8 flex flex-col gap-6',
      highlight
        ? 'bg-text-forest text-white ring-2 ring-text-forest'
        : 'bg-bg-cream ring-1 ring-text-forest/12',
    ].join(' ')}>

      {/* Tier name + price */}
      <div>
        <p className={`font-body text-sm font-semibold uppercase tracking-widest mb-2 ${highlight ? 'text-white/60' : 'text-text-sage'}`}>
          {title}
        </p>
        <p className={`font-display text-5xl font-semibold ${highlight ? 'text-white' : 'text-text-forest'}`}>
          {price}
        </p>
        {priceNote && (
          <p className={`font-body text-sm mt-1 ${highlight ? 'text-white/60' : 'text-text-sage'}`}>
            {priceNote}
          </p>
        )}
      </div>

      {/* Feature list */}
      <ul className="flex flex-col gap-3 flex-1">
        {features.map(f => (
          <li key={f.label} className="flex items-start gap-3">
            {f.included
              ? <span className={highlight ? 'text-white' : 'text-primary'}><CheckIcon /></span>
              : <CrossIcon />
            }
            <span className={`font-body text-base ${highlight ? 'text-white/80' : f.included ? 'text-text-forest' : 'text-text-sage/50'}`}>
              {f.label}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {ctaTo ? (
        <Link
          to={ctaTo}
          className={[
            'w-full text-center font-body font-semibold text-lg py-3.5 rounded-2xl transition-colors',
            highlight
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-text-forest/8 text-text-forest hover:bg-text-forest/15',
          ].join(' ')}
        >
          {cta}
        </Link>
      ) : (
        <span className={`w-full text-center font-body font-semibold text-lg py-3.5 rounded-2xl ${highlight ? 'bg-white/10 text-white/60' : 'bg-text-forest/5 text-text-sage/60'} cursor-default`}>
          {cta}
        </span>
      )}
    </div>
  )
}

function PricingSection() {
  return (
    <section id="pricing" className="bg-bg-rose py-20 md:py-28">
      <div className="max-w-4xl mx-auto px-5 sm:px-6">
        <h2 className="font-display text-4xl md:text-5xl font-semibold text-text-forest text-center mb-4">
          Simple, honest pricing
        </h2>
        {/* TODO: Replace with final pricing description */}
        <p className="font-body text-xl text-text-sage text-center mb-14 max-w-xl mx-auto">
          Start free. Upgrade when you're ready.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PricingCard
            title="Free"
            price="$0"
            priceNote="Forever free — no card needed"
            features={FREE_FEATURES}
            cta="Get started free"
            ctaTo="/signup"
            highlight={false}
          />
          <PricingCard
            title="Premium"
            // TODO: Set final price
            price="Coming soon"
            priceNote="Pricing to be announced"
            features={PAID_FEATURES}
            cta="Coming soon"
            ctaTo={null}
            highlight={true}
          />
        </div>
      </div>
    </section>
  )
}

// ── CTA Band ──────────────────────────────────────────────────────────────────

function CtaBand() {
  return (
    <section className="bg-bg-mint py-20 md:py-28 text-center px-5 sm:px-6">
      {/* TODO: Replace with final CTA headline */}
      <h2 className="font-display text-4xl md:text-5xl font-semibold text-text-forest mb-4 max-w-xl mx-auto leading-tight">
        Give your child a tool that actually works
      </h2>
      {/* TODO: Replace with final CTA subtext */}
      <p className="font-body text-xl text-text-sage mb-10 max-w-md mx-auto">
        Free to start. No app download. Works on any tablet or phone.
      </p>
      <Link
        to="/signup"
        className="inline-block font-body font-semibold text-xl bg-primary text-white px-10 py-5 rounded-2xl hover:bg-primary/90 active:bg-primary/80 transition-colors shadow-sm"
      >
        Sign Up Free
      </Link>
      <p className="font-body text-sm text-text-sage/70 mt-4">
        No credit card required for free tier.
      </p>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function LandingFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="bg-blue-navy py-10 px-5 sm:px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <Link
          to="/"
          className="font-display text-2xl font-semibold text-white hover:text-white/80 transition-colors"
        >
          Whoosha
        </Link>
        <div className="flex flex-wrap items-center justify-center gap-6 font-body text-sm text-white/50">
          {/* TODO: Link to real privacy policy page when created */}
          <a href="#" className="hover:text-white/80 transition-colors">Privacy Policy</a>
          {/* TODO: Link to real terms of service page when created */}
          <a href="#" className="hover:text-white/80 transition-colors">Terms of Service</a>
          <span>© {year} Whoosha</span>
        </div>
      </div>
    </footer>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="bg-bg-cream">
      <Navbar />
      <HeroSection />
      <ScienceSection />
      <FeaturesSection />
      <PricingSection />
      <CtaBand />
      <LandingFooter />
    </div>
  )
}
