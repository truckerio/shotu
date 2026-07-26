import { ChevronDown } from "@untitledui/icons";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function OptionalSection({
  children,
  className = "",
  description = "",
  onToggle,
  open,
  title,
}) {
  function handleToggle(event) {
    onToggle?.(event.currentTarget.open);
  }

  return (
    <details
      className={joinClassNames("operational-optional-section", className)}
      open={open}
      onToggle={handleToggle}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="operational-optional-section-content">{children}</div>
    </details>
  );
}
