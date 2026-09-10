import { forwardRef } from "react";
import "./checkbox.css";

export const Checkbox = forwardRef(function Checkbox({ className = "", ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={`shared-checkbox ${className}`.trim()}
    />
  );
});
