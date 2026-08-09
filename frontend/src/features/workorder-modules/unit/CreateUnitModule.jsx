import { useEffect, useState } from "react";
import { CustomerCompanyField, FormField, FormSection, OptionalSection, UnitSummary } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";

export function CreateUnitModule({ access, activeSection, errors, form, onChange, onUnitChange, onVehicleSelect, selectedVehicle, vehicleLookup }) {
  const [unitDetailsOpen, setUnitDetailsOpen] = useState(false);
  const selectedVehicleId = selectedVehicle?.id || selectedVehicle?.provider_vehicle_id || "";
  useEffect(() => setUnitDetailsOpen(false), [selectedVehicleId]);
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="unit" className="create-unit-card" title="Unit & customer" summary="Select the equipment and confirm who owns or operates it." activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title="Unit" description="Search by unit number, VIN, truck name, or license plate.">
        <div className="operational-unit-lookup">
          <FormField id="workorder-unit" label="Unit" error={errors?.unitNo} required>
            <input {...textEntryProps("search")} role="combobox" aria-autocomplete="list" aria-controls="create-vehicle-suggestions" aria-expanded={Boolean(vehicleLookup.results?.length)} autoComplete="off" enterKeyHint="search" value={form.unitNo} onChange={(event) => onUnitChange(event.target.value)} placeholder="Unit, VIN, or license" />
          </FormField>
          {vehicleLookup.loading ? <p className="operational-inline-status">Searching units...</p> : null}
          {vehicleLookup.results?.length ? <div className="operational-unit-results" id="create-vehicle-suggestions" role="listbox" aria-label="Unit suggestions">{vehicleLookup.results.map((vehicle) => (
            <button key={vehicle.id} type="button" role="option" aria-selected="false" onClick={() => onVehicleSelect(vehicle)}><strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed unit"}</strong><span>{[vehicle.unit_type, vehicle.owner_name, [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "), vehicle.vin, vehicle.license_plate].filter(Boolean).join(" / ")}</span></button>
          ))}</div> : null}
        </div>
        {selectedVehicle ? <UnitSummary editing={unitDetailsOpen} unit={{ unitNo: form.unitNo, unitType: form.unitType, vehicle: form.model, vin: form.vinNo, license: form.licenseNo, mileage: form.mileage }} onEdit={() => setUnitDetailsOpen((open) => !open)} onFieldChange={onChange} editLabel={unitDetailsOpen ? "Done editing" : "Edit unit details"} /> : null}
        {!selectedVehicle ? <OptionalSection title="Unit details" description="Add details when the unit is not available from Samsara." open>
          <div className="operational-form-grid two">
            <FormField id="workorder-unit-type" label="Unit type"><select value={form.unitType} onChange={(event) => onChange("unitType", event.target.value)}><option value="">Select type</option><option value="Truck">Truck</option><option value="Trailer">Trailer</option><option value="Other">Other</option></select></FormField>
            <FormField id="workorder-license" label="License"><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.licenseNo} onChange={(event) => onChange("licenseNo", event.target.value)} /></FormField>
            <FormField id="workorder-mileage" label="Mileage"><input {...textEntryProps("identifier")} enterKeyHint="next" inputMode="numeric" value={form.mileage} onChange={(event) => onChange("mileage", event.target.value)} /></FormField>
            <FormField id="workorder-model" label="Model"><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.model} onChange={(event) => onChange("model", event.target.value)} /></FormField>
          </div>
          <FormField id="workorder-vin" label="VIN"><input {...textEntryProps("identifier")} enterKeyHint="done" value={form.vinNo} onChange={(event) => onChange("vinNo", event.target.value)} /></FormField>
        </OptionalSection> : null}
      </FormSection>
      <FormSection title="Customer"><CustomerCompanyField value={form.customerCompanyName} onChange={(value) => onChange("customerCompanyName", value)} error={errors?.customerCompanyName} required /></FormSection>
    </ProgressiveWorkorderSection>
  );
}
