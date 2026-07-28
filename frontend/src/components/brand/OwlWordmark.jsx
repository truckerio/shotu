import "./owl-wordmark.css";

export const PRODUCT_NAME = "Owl";

export function OwlWordmark({ className = "", mark = null }) {
  return (
    <span className={`owl-wordmark ${className}`.trim()} aria-label={mark ? undefined : PRODUCT_NAME}>
      {mark || <span className="owl-wordmark-mark" aria-hidden="true">O</span>}
      <span className="owl-wordmark-suffix" aria-hidden="true">wl</span>
    </span>
  );
}
