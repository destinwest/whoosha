// Reusable card component — built when first needed
export default function Card({ children, className = '' }) {
  return (
    <div className={className}>
      {children}
    </div>
  )
}
