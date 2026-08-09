import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { getVehicleLocation } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

function ReadOnlyUnit({ form, workorder }) {
  return (
    <dl className="workorder-readonly-details">
      <div><dt>Unit</dt><dd>{form.unitNo || "Not listed"}</dd></div>
      <div><dt>Type</dt><dd>{form.unitType || "Not listed"}</dd></div>
      <div><dt>Model</dt><dd>{form.model || "Not listed"}</dd></div>
      <div><dt>Mileage</dt><dd>{form.mileage ? `${form.mileage} mi` : "Not listed"}</dd></div>
      <div><dt>VIN</dt><dd>{form.vinNo || "Not listed"}</dd></div>
      <div><dt>License</dt><dd>{form.licenseNo || "Not listed"}</dd></div>
      <div><dt>Customer</dt><dd>{form.customerCompanyName || "Not listed"}</dd></div>
      <div><dt>Workorder</dt><dd>{workorder?.serial || "Not listed"}</dd></div>
    </dl>
  );
}

export function WorkorderUnitModule({
  access,
  activeWorkorder,
  detailSection,
  form,
  onApplyVehicle,
  onFieldChange,
  onSelect,
  onUnitNumberChange,
  vehicleLookup,
  vehicleMileage,
  vehicleModelText,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(activeWorkorder.allowedActions?.update);

  return (
    <ProgressiveWorkorderSection
      id="unit"
      title={`${form.unitType || "Unit"} details`}
      summary={[form.unitNo, form.customerCompanyName].filter(Boolean).join(" · ") || "Unit and customer information"}
      activeSection={detailSection}
      onSelect={onSelect}
      displayMode="panel"
    >
      {canWrite ? (
        <div className="workorder-unit-content">
          <div className="unit-field-wrap">
            <label className="field">
              <span className="field-label-row">Unit no.</span>
              <input
                {...textEntryProps("search")}
                aria-label="Unit no."
                aria-autocomplete="list"
                aria-controls="vehicle-suggestions"
                aria-expanded={vehicleLookup.results.length > 0}
                role="combobox"
                value={form.unitNo}
                onChange={(event) => onUnitNumberChange(event.target.value)}
                autoComplete="off"
              />
            </label>
            {vehicleLookup.loading ? <p className="vehicle-inline-status">Searching...</p> : null}
            {vehicleLookup.results.length ? (
              <div className="vehicle-results" id="vehicle-suggestions" role="listbox" aria-label="Vehicle suggestions">
                {vehicleLookup.results.map((vehicle) => (
                  <button type="button" role="option" aria-selected="false" key={vehicle.id} onClick={() => onApplyVehicle(vehicle)}>
                    <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed vehicle"}</strong>
                    <span>{[vehicle.unit_type, vehicle.owner_name, vehicleModelText(vehicle), vehicle.vin, vehicle.license_plate, vehicleMileage(vehicle) ? `${vehicleMileage(vehicle)} mi` : "", getVehicleLocation(vehicle) ? "Map" : ""].filter(Boolean).join(" / ")}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="two-col">
            <Field label="Unit type"><select value={form.unitType} onChange={(event) => onFieldChange("unitType", event.target.value)}><option value="">Select type</option><option value="Truck">Truck</option><option value="Trailer">Trailer</option><option value="Other">Other</option></select></Field>
            <Field label="License"><input {...textEntryProps("identifier")} value={form.licenseNo} onChange={(event) => onFieldChange("licenseNo", event.target.value)} /></Field>
          </div>
          <div className="two-col">
            <Field label="Mileage"><input {...textEntryProps("identifier")} value={form.mileage} onChange={(event) => onFieldChange("mileage", event.target.value)} /></Field>
            <Field label="Model"><input {...textEntryProps("identifier")} value={form.model} onChange={(event) => onFieldChange("model", event.target.value)} /></Field>
          </div>
          <div className="two-col">
            <Field label="Customer company"><input {...textEntryProps("name")} value={form.customerCompanyName} onChange={(event) => onFieldChange("customerCompanyName", event.target.value)} /></Field>
            <Field label="VIN no."><input {...textEntryProps("identifier")} value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} /></Field>
          </div>
        </div>
      ) : <ReadOnlyUnit form={form} workorder={activeWorkorder.workorder} />}
    </ProgressiveWorkorderSection>
  );
}
