export function Button({ children, variant = "secondary", icon: Icon, className = "", ...props }) {
  return (
    <button className={`button ${variant} ${className}`.trim()} {...props}>
      {Icon ? <Icon aria-hidden="true" focusable="false" /> : null}
      <span>{children}</span>
    </button>
  );
}
