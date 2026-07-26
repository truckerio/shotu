import { Edit05 } from "@untitledui/icons";
import { Button } from "../ui/Button.jsx";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "Not provided" : String(value);
}

export function UnitSummary({
  className = "",
  unit = {},
  onEdit,
  editLabel = "Edit unit details",
}) {
  const title = unit.unitNo || unit.name || unit.vin || "Selected unit";
  const type = unit.unitType || unit.type || "Unit";
  const vehicle = [unit.year, unit.make, unit.model].filter(Boolean).join(" ");
  const details = [
    ["Type", type],
    ["Vehicle", vehicle],
    ["VIN", unit.vin],
    ["License", unit.license || unit.licensePlate],
    ["Mileage", unit.mileage],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <section className={joinClassNames("operational-unit-summary", className)} aria-label={`${title} summary`}>
      <div className="operational-unit-summary-header">
        <div>
          <span>{type}</span>
          <strong>{title}</strong>
        </div>
        {onEdit ? <Button icon={Edit05} type="button" onClick={onEdit}>{editLabel}</Button> : null}
      </div>
      {details.length ? (
        <dl>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{displayValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
