export function Button({ children, variant = "secondary", icon: Icon, className = "", ...props }) {
  return (
    <button className={`button ${variant} ${className}`.trim()} {...props}>
      {Icon ? <Icon /> : null}
      <span>{children}</span>
    </button>
  );
}
