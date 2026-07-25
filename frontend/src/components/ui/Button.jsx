export function Button({ children, variant = "secondary", icon: Icon, ...props }) {
  return (
    <button className={`button ${variant}`} {...props}>
      {Icon ? <Icon /> : null}
      <span>{children}</span>
    </button>
  );
}
