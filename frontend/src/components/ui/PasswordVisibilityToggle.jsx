import { Eye, EyeOff } from "@untitledui/icons";
import "./password-visibility-toggle.css";

export function PasswordVisibilityToggle({ visible, onToggle, controls }) {
  const label = visible ? "Hide password" : "Show password";

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
