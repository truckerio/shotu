import { forwardRef } from "react";
import "./workorder-parts-table.css";

function classes(...values) {
  return values.filter(Boolean).join(" ");
}

export const WORKORDER_PARTS_COLUMNS = Object.freeze({
  PRODUCT: "product",
  QUANTITY_UOM: "quantity-uom",
  REPAIR_ORDER: "repair-order",
  STATUS_ACTION: "status-action",
});

export const DEFAULT_WORKORDER_PARTS_COLUMNS = Object.freeze([
  WORKORDER_PARTS_COLUMNS.PRODUCT,
  WORKORDER_PARTS_COLUMNS.QUANTITY_UOM,
  WORKORDER_PARTS_COLUMNS.REPAIR_ORDER,
]);

export const DETAIL_WORKORDER_PARTS_COLUMNS = Object.freeze([
  ...DEFAULT_WORKORDER_PARTS_COLUMNS,
  WORKORDER_PARTS_COLUMNS.STATUS_ACTION,
]);

export const WORKORDER_PARTS_COLUMN_DESCRIPTORS = Object.freeze({
  [WORKORDER_PARTS_COLUMNS.PRODUCT]: Object.freeze({ track: "minmax(0, 1.1fr)" }),
  [WORKORDER_PARTS_COLUMNS.QUANTITY_UOM]: Object.freeze({ track: "var(--workorder-parts-quantity-track, minmax(126px, 0.85fr))" }),
  [WORKORDER_PARTS_COLUMNS.REPAIR_ORDER]: Object.freeze({ track: "minmax(0, 1fr)" }),
  [WORKORDER_PARTS_COLUMNS.STATUS_ACTION]: Object.freeze({ track: "minmax(220px, 0.9fr)" }),
});

const ROW_ORDINAL_TRACK = "24px";
const CREATE_ROW_ACTION_TRACK = "64px";
const FUTURE_COLUMN_TRACK = "minmax(0, 1fr)";

function gridTemplateFor(columns) {
  const columnTracks = columns.map((column) => (
    WORKORDER_PARTS_COLUMN_DESCRIPTORS[column]?.track || FUTURE_COLUMN_TRACK
  ));
  const trailingTrack = columns.includes(WORKORDER_PARTS_COLUMNS.STATUS_ACTION)
    ? []
    : [CREATE_ROW_ACTION_TRACK];
  return [ROW_ORDINAL_TRACK, ...columnTracks, ...trailingTrack].join(" ");
}

export function WorkorderPartsTable({
  children,
  className = "",
  columns,
  gridTemplate,
  style,
  ...props
}) {
  const legacyDetailColumns = className.split(" ").includes("used-parts-items-table")
    ? DETAIL_WORKORDER_PARTS_COLUMNS
    : DEFAULT_WORKORDER_PARTS_COLUMNS;
  const normalizedColumns = Array.isArray(columns) && columns.length ? columns : legacyDetailColumns;
  return (
    <div
      className={classes("operational-parts-editor", "workorder-parts-grid", className)}
      data-workorder-parts-columns={normalizedColumns.join(" ")}
      style={{ "--workorder-parts-grid-template": gridTemplate || gridTemplateFor(normalizedColumns), ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export const WorkorderPartsRow = forwardRef(function WorkorderPartsRow({ children, className = "", ...props }, ref) {
  return <div ref={ref} className={classes("operational-part-row", "has-quantity-unit", className)} {...props}>{children}</div>;
});

export function WorkorderPartsActions({ children, className = "", ...props }) {
  return <div className={classes("workorder-parts-actions", className)} {...props}>{children}</div>;
}

export function WorkorderPartsColumnHead({ columns = DEFAULT_WORKORDER_PARTS_COLUMNS, labels, className = "", ...props }) {
  const normalizedColumns = Array.isArray(columns) && columns.length
    ? columns
    : DEFAULT_WORKORDER_PARTS_COLUMNS;
  return (
    <div className={classes("workorder-parts-column-head", className)} aria-hidden="true" {...props}>
      <span>#</span>
      {normalizedColumns.map((column) => <span key={column}>{labels?.[column] || ""}</span>)}
    </div>
  );
}
