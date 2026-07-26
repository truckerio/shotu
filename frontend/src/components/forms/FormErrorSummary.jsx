import { useEffect, useRef } from "react";
import { normalizeFormErrors } from "./form-utils.js";
import "./operational-form.css";

export function FormErrorSummary({
  errors,
  focusFirstField = false,
  focusKey = 0,
  focusOnMount = false,
  title = "There is a problem",
}) {
  const items = normalizeFormErrors(errors);
  const summaryRef = useRef(null);
  const errorSignature = items.map((item) => `${item.key}:${item.id}:${item.message}`).join("|");

  useEffect(() => {
    if (!focusOnMount || !items.length) return;

    const firstField = focusFirstField && items[0].id
      ? document.getElementById(items[0].id)
      : null;
    if (firstField) {
      firstField.scrollIntoView({ behavior: "smooth", block: "center" });
      firstField.focus({ preventScroll: true });
      return;
    }
    summaryRef.current?.focus();
  }, [errorSignature, focusFirstField, focusKey, focusOnMount]);

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
