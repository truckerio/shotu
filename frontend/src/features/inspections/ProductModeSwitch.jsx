export function ProductModeSwitch({ value, onChange }) {
  return <div className="inspection-product-switch" role="group" aria-label="Operations type">
    <button type="button" className={value === "workorders" ? "active" : ""} aria-pressed={value === "workorders"} onClick={() => onChange("workorders")}>Workorders</button>
    <button type="button" className={value === "inspections" ? "active" : ""} aria-pressed={value === "inspections"} onClick={() => onChange("inspections")}>Inspections</button>
  </div>;
}
