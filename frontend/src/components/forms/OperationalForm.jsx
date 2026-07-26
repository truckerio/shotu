import { forwardRef } from "react";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export const OperationalForm = forwardRef(function OperationalForm({
  children,
  className = "",
  busy = false,
  onSubmit,
  ...props
}, ref) {
  return (
    <form
      {...props}
      ref={ref}
      className={joinClassNames("operational-form", className)}
      aria-busy={busy || undefined}
      onSubmit={onSubmit}
    >
      {children}
    </form>
  );
});
