import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function ActionFooter({
  children,
  className = "",
  message = "",
  stickyOnMobile = false,
}) {
  return (
    <footer className={joinClassNames(
      "operational-action-footer",
      stickyOnMobile && "is-sticky-on-mobile",
      className,
    )}>
      <div className="operational-action-footer-message" aria-live="polite">{message}</div>
      <div className="operational-action-footer-actions">{children}</div>
    </footer>
  );
}
