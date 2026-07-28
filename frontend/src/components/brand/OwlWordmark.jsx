import "./owl-wordmark.css";

export const PRODUCT_NAME = "Owl";

export function OwlProfileMark({ className = "" }) {
  return (
    <svg
      className={`owl-profile-mark ${className}`.trim()}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path className="owl-profile-mark-ring" d="M7.5 25.75A13 13 0 1 1 24.5 25.75" />
      <circle className="owl-profile-mark-head" cx="16" cy="19" r="4" />
      <path className="owl-profile-mark-shoulders" d="M7.75 27.25C9.7 24.92 12.45 23.75 16 23.75s6.3 1.17 8.25 3.5A13.9 13.9 0 0 1 16 29.5a13.9 13.9 0 0 1-8.25-2.25Z" />
    </svg>
  );
}

export function OwlWordmark({ className = "", mark = null }) {
  return (
    <span className={`owl-wordmark ${className}`.trim()} aria-label={mark ? undefined : PRODUCT_NAME}>
      {mark || <OwlProfileMark className="owl-wordmark-mark" />}
      <span className="owl-wordmark-suffix" aria-hidden="true">wl</span>
    </span>
  );
}
