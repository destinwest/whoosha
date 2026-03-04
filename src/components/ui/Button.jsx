// Reusable button component — built when first needed
export default function Button({ children, onClick, className = '', ...props }) {
  return (
    <button onClick={onClick} className={className} {...props}>
      {children}
    </button>
  )
}
