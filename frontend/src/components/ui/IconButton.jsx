import "./icon-button.css";

export function IconButton({
  className = "",
  icon: Icon,
  label,
  title = label,
  tone = "neutral",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={`shared-icon-button is-${tone} ${className}`.trim()}
      aria-label={label}
      title={title}
    >
      {Icon ? <Icon aria-hidden="true" focusable="false" /> : null}
    </button>
  );
}
