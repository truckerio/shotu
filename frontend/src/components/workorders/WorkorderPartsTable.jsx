import { forwardRef } from "react";
import "./workorder-parts-table.css";

function classes(...values) {
  return values.filter(Boolean).join(" ");
}

export function WorkorderPartsTable({ children, className = "", ...props }) {
  return <div className={classes("operational-parts-editor", className)} {...props}>{children}</div>;
}

export const WorkorderPartsRow = forwardRef(function WorkorderPartsRow({ children, className = "", ...props }, ref) {
  return <div ref={ref} className={classes("operational-part-row", "has-quantity-unit", className)} {...props}>{children}</div>;
});

export function WorkorderPartsActions({ children, className = "", ...props }) {
  return <div className={classes("workorder-parts-actions", className)} {...props}>{children}</div>;
}
