import { Dropdown } from "./Dropdown.jsx";
import { Edit05 } from "@untitledui/icons";
import { Button } from "../ui/Button.jsx";
import { joinClassNames } from "./form-utils.js";
import { textEntryProps } from "./text-entry-policy.js";
import { interfaceText } from "../../i18n/index.js";
import "./operational-form.css";

function displayValue(value, fallback) {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

export function UnitSummary({
  className = "",
  editing = false,
  unit = {},
  onEdit,
  onFieldChange,
  editLabel = "Edit unit details",
  locale = "en",
}) {
  const t = (key) => interfaceText(locale, key);
  const title = unit.unitNo || unit.name || unit.vin || t("unit.selected");
  const typeValue = unit.unitType || unit.type || "Unit";
  const type = ({ Unit: t("unit.title"), Truck: t("unit.truck"), Trailer: t("unit.trailer"), Other: t("unit.other") })[typeValue] || typeValue;
  const vehicle = unit.vehicle || [unit.year, unit.make, unit.model].filter(Boolean).join(" ");
  const details = [
    { label: t("unit.type"), value: type, field: "unitType", control: "select" },
    { label: t("unit.vehicle"), value: vehicle, field: "model" },
    { label: t("unit.vin"), value: unit.vin, field: "vinNo" },
    { label: t("unit.license"), value: unit.license || unit.licensePlate, field: "licenseNo" },
    {
      label: t("unit.mileage"),
      value: unit.mileage,
      displayValue: unit.mileage ? `${unit.mileage} ${t("unit.milesShort")}` : "",
      field: "mileage",
      inputMode: "numeric",
    },
  ].filter(({ value }) => editing || (value !== null && value !== undefined && value !== ""));

  return (
    <section
      className={joinClassNames("operational-unit-summary", editing && "is-editing", className)}
      aria-label={`${title} ${t("unit.summaryLabel")}`}
    >
      <div className="operational-unit-summary-header">
        <div>
          <span>{type}</span>
          <strong>{title}</strong>
        </div>
        {onEdit ? <Button icon={Edit05} type="button" onClick={onEdit}>{editLabel}</Button> : null}
      </div>
      {details.length ? (
        <dl>
          {details.map(({ control, displayValue: formattedValue, field, inputMode, label, value }) => (
            <div key={label}>
              <dt><label htmlFor={`selected-unit-${field}`}>{label}</label></dt>
              <dd>
                {editing && onFieldChange ? (
                  control === "select" ? (
                    <Dropdown
                      id={`selected-unit-${field}`}
                      value={typeValue === "Unit" ? "" : typeValue}
                      onChange={(event) => onFieldChange(field, event.target.value)}
                    >
                      <option value="">{t("unit.selectType")}</option>
                      <option value="Truck">{t("unit.truck")}</option>
                      <option value="Trailer">{t("unit.trailer")}</option>
                      <option value="Other">{t("unit.other")}</option>
                    </Dropdown>
                  ) : (
                    <input
                      {...textEntryProps("identifier")}
                      id={`selected-unit-${field}`}
                      inputMode={inputMode}
                      value={value || ""}
                      onChange={(event) => onFieldChange(field, event.target.value)}
                    />
                  )
                ) : displayValue(formattedValue || value, t("unit.notProvided"))}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
