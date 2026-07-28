import { useEffect, useRef } from "react";
import { normalizeFormErrors } from "./form-utils.js";
import "./operational-form.css";

function shouldScheduleFormErrorFocus({ focusOnMount, focusReady, itemCount }) {
  return Boolean(focusOnMount && focusReady && itemCount > 0);
}

export function FormErrorSummary({
  errors,
  focusFirstField = false,
  focusKey = 0,
  focusOnMount = false,
  focusReady = true,
  onFocusTarget,
  title = "There is a problem",
}) {
  const items = normalizeFormErrors(errors);
  const summaryRef = useRef(null);
  const errorSignature = items.map((item) => `${item.key}:${item.id}:${item.message}`).join("|");

  useEffect(() => {
    if (!shouldScheduleFormErrorFocus({
      focusOnMount,
      focusReady,
      itemCount: items.length,
    })) return undefined;

    let firstFrame = null;
    let settledFrame = null;

    firstFrame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => {
        const firstField = focusFirstField && items[0].id
          ? document.getElementById(items[0].id)
          : null;
        if (firstField) {
          firstField.focus({ preventScroll: true });
          const handled = onFocusTarget?.(firstField);
          if (!handled) firstField.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        summaryRef.current?.focus();
        onFocusTarget?.(summaryRef.current);
      });
    });

    return () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
    };
  }, [errorSignature, focusFirstField, focusKey, focusOnMount, focusReady, onFocusTarget]);

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
