import { Eye, EyeOff } from "@untitledui/icons";
import "./password-visibility-toggle.css";

export function PasswordVisibilityToggle({ visible, onToggle, controls, hideLabel = "Hide password", showLabel = "Show password" }) {
  const label = visible ? hideLabel : showLabel;

  return (
    <button
      className="password-visibility-toggle"
      type="button"
      onClick={onToggle}
      aria-controls={controls}
      aria-label={label}
      title={label}
    >
      {visible ? <EyeOff /> : <Eye />}
    </button>
  );
}
