import { Children, cloneElement, isValidElement, useId } from "react";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

function controlWithAccessibility(control, accessibility) {
  if (typeof control === "function") return control(accessibility);
  if (!isValidElement(control)) return control;

  const existingDescription = control.props["aria-describedby"];
  return cloneElement(control, {
    id: control.props.id || accessibility.id,
    "aria-describedby": [existingDescription, accessibility.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": accessibility.invalid || control.props["aria-invalid"] || undefined,
    "aria-required": accessibility.required || control.props["aria-required"] || undefined,
    required: accessibility.required || control.props.required || undefined,
  });
}

export function FormField({
  children,
  className = "",
  error = "",
  hint = "",
  id,
  label,
  required = false,
}) {
  const generatedId = useId();
  const controlId = id || `operational-field-${generatedId.replaceAll(":", "")}`;
  const hintId = hint ? `${controlId}-hint` : "";
  const errorId = error ? `${controlId}-error` : "";
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = typeof children === "function"
    ? children
    : Children.count(children) === 1
      ? Children.only(children)
      : children;

  return (
    <div className={joinClassNames("operational-form-field", error && "has-error", className)}>
      <label className="operational-form-field-label" htmlFor={controlId}>
        {label}
        {required ? <span className="operational-form-required" aria-hidden="true">Required</span> : null}
      </label>
      {hint ? <span className="operational-form-field-hint" id={hintId}>{hint}</span> : null}
      {controlWithAccessibility(control, {
        describedBy,
        id: controlId,
        invalid: Boolean(error),
        required,
      })}
      {error ? <span className="operational-form-field-error" id={errorId}>{error}</span> : null}
    </div>
  );
}
