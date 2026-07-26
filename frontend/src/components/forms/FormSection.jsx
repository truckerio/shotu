import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function FormSection({
  children,
  className = "",
  title,
  description = "",
  action = null,
  disabled = false,
  ...props
}) {
  return (
    <fieldset
      {...props}
      className={joinClassNames("operational-form-section", className)}
      disabled={disabled}
    >
      <legend className="operational-form-section-legend">
        <span className="operational-form-section-heading">
          <span className="operational-form-section-title">{title}</span>
          {description ? <span className="operational-form-section-description">{description}</span> : null}
        </span>
        {action ? <span className="operational-form-section-action">{action}</span> : null}
      </legend>
      <div className="operational-form-section-content">{children}</div>
    </fieldset>
  );
}
