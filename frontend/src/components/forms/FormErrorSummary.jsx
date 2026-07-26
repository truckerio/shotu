import { useEffect, useRef } from "react";
import { normalizeFormErrors } from "./form-utils.js";
import "./operational-form.css";

export function FormErrorSummary({
  errors,
  focusOnMount = false,
  title = "There is a problem",
}) {
  const items = normalizeFormErrors(errors);
  const summaryRef = useRef(null);

  useEffect(() => {
    if (focusOnMount && items.length) summaryRef.current?.focus();
  }, [focusOnMount, items.length]);

  if (!items.length) return null;

  return (
    <div
      className="operational-form-error-summary"
      ref={summaryRef}
      role="alert"
      tabIndex="-1"
    >
      <strong>{title}</strong>
      <ul>
        {items.map((error) => (
          <li key={error.key}>
            {error.id ? <a href={`#${error.id}`}>{error.message}</a> : error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
