import { useState } from "react";
import {
  ActionFooter,
  CustomerCompanyField,
  FormCard,
  FormErrorSummary,
  FormField,
  FormSection,
  MechanicMultiSelect,
  OperationalForm,
  OptionalSection,
  UnitSummary,
} from "../../components/forms/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { AssetLocationCard } from "../../components/workorders/AssetLocationCard.jsx";

export function CreateWorkorderForm({
  assignment,
  busy,
  errors,
  form,
  locations,
  mapsConfig,
  message,
  onAddPart,
  onAssignmentChange,
  onFieldChange,
  onLocationChange,
  onPartChange,
  onRemovePart,
  onSubmit,
  onUnitChange,
  onVehicleSelect,
  selectedVehicle,
  vehicleLookup,
}) {
  const [unitDetailsOpen, setUnitDetailsOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const locationOptions = locations || [];
  const mechanics = assignment?.mechanics || [];

  return (
    <OperationalForm className="create-workorder-form" busy={busy} onSubmit={onSubmit} noValidate>
      <FormErrorSummary errors={errors} focusOnMount title="Check the workorder details" />

      <FormCard title="Workorder" description="Repair location, schedule, and requested work.">
        <FormSection title="Work context">
          {locationOptions.length ? (
            <FormField id="workorder-location" label="Location" error={errors?.locationId} required>
              <select value={form.locationId} onChange={(event) => onLocationChange(event.target.value)}>
                <option value="">Select location</option>
                {locationOptions.map((entry) => (
                  <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>
                ))}
              </select>
            </FormField>
          ) : null}
          <div className="operational-form-grid two">
            <FormField id="workorder-start-date" label="Start date" required>
              <input type="date" value={form.workStartDate} onChange={(event) => onFieldChange("workStartDate", event.target.value)} />
            </FormField>
            <FormField id="workorder-end-date" label="End date">
              <input
                type="date"
                value={form.workEndDate}
                min={form.workStartDate || undefined}
                onChange={(event) => onFieldChange("workEndDate", event.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Problem">
          <FormField
            id="workorder-concern"
            label="Mechanic concern"
            hint="Describe what needs to be inspected or repaired."
            error={errors?.mechanicConcern}
            required
          >
            <textarea
              rows="4"
              value={form.mechanicConcern}
              onChange={(event) => onFieldChange("mechanicConcern", event.target.value)}
            />
          </FormField>
        </FormSection>
      </FormCard>

      <FormCard title="Unit & customer" description="Select the equipment and confirm who owns or operates it.">
        <FormSection title="Unit" description="Search by unit number, VIN, truck name, or license plate.">
        <div className="operational-unit-lookup">
          <FormField id="workorder-unit" label="Unit" error={errors?.unitNo} required>
            <input
              role="combobox"
              aria-autocomplete="list"
              aria-controls="create-vehicle-suggestions"
              aria-expanded={Boolean(vehicleLookup.results?.length)}
              autoComplete="off"
              value={form.unitNo}
              onChange={(event) => onUnitChange(event.target.value)}
              placeholder="Unit, VIN, or license"
            />
          </FormField>
          {vehicleLookup.loading ? <p className="operational-inline-status">Searching units...</p> : null}
          {vehicleLookup.results?.length ? (
            <div className="operational-unit-results" id="create-vehicle-suggestions" role="listbox" aria-label="Unit suggestions">
              {vehicleLookup.results.map((vehicle) => (
                <button key={vehicle.id} type="button" role="option" aria-selected="false" onClick={() => onVehicleSelect(vehicle)}>
                  <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed unit"}</strong>
                  <span>{[
                    vehicle.unit_type,
                    vehicle.owner_name,
                    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
                    vehicle.vin,
                    vehicle.license_plate,
                  ].filter(Boolean).join(" / ")}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {selectedVehicle ? (
          <>
            <UnitSummary
              unit={{
                unitNo: form.unitNo,
                unitType: form.unitType,
                year: selectedVehicle.year,
                make: selectedVehicle.make,
                model: selectedVehicle.model || form.model,
                vin: form.vinNo,
                license: form.licenseNo,
                mileage: form.mileage ? `${form.mileage} mi` : "",
              }}
              onEdit={() => setUnitDetailsOpen((open) => !open)}
              editLabel={unitDetailsOpen ? "Hide unit details" : "Edit unit details"}
            />
            <AssetLocationCard
              vehicle={selectedVehicle}
              mapsConfig={mapsConfig}
              showVehicleLabel={false}
            />
          </>
        ) : null}

        <OptionalSection
          title="Unit details"
          description="Add or correct details when the imported record is incomplete."
          open={unitDetailsOpen || !selectedVehicle}
          onToggle={setUnitDetailsOpen}
        >
          <div className="operational-form-grid two">
            <FormField id="workorder-unit-type" label="Unit type">
              <select value={form.unitType} onChange={(event) => onFieldChange("unitType", event.target.value)}>
                <option value="">Select type</option>
                <option value="Truck">Truck</option>
                <option value="Trailer">Trailer</option>
                <option value="Other">Other</option>
              </select>
            </FormField>
            <FormField id="workorder-license" label="License">
              <input value={form.licenseNo} onChange={(event) => onFieldChange("licenseNo", event.target.value)} />
            </FormField>
            <FormField id="workorder-mileage" label="Mileage">
              <input inputMode="numeric" value={form.mileage} onChange={(event) => onFieldChange("mileage", event.target.value)} />
            </FormField>
            <FormField id="workorder-model" label="Model">
              <input value={form.model} onChange={(event) => onFieldChange("model", event.target.value)} />
            </FormField>
          </div>
          <FormField id="workorder-vin" label="VIN">
            <input value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} />
          </FormField>
        </OptionalSection>
        </FormSection>

        <FormSection title="Customer">
          <CustomerCompanyField
            value={form.customerCompanyName}
            onChange={(value) => onFieldChange("customerCompanyName", value)}
            error={errors?.customerCompanyName}
            required
          />
        </FormSection>
      </FormCard>

      <FormCard title="Assignment" description="Choose the mechanic team and record any parts already known.">
        <FormSection title="Mechanics" description="Leave the team empty to make this work available for mechanics to accept.">
          <MechanicMultiSelect
            mechanics={mechanics}
            selectedIds={assignment?.mechanicUserIds || []}
            onChange={onAssignmentChange}
            disabled={assignment?.loading}
            emptyMessage={assignment?.loading ? "Loading mechanics..." : "No active mechanics at this location."}
            description=""
          />
          {!assignment?.mechanicUserIds?.length ? (
            <p className="operational-availability-note">This workorder will appear in the available queue.</p>
          ) : null}
        </FormSection>

        <OptionalSection
          title="Known parts"
          description="Optional. Mechanics can confirm the parts actually used later."
          open={partsOpen}
          onToggle={setPartsOpen}
        >
          <div className="operational-parts-editor">
            {form.parts.map((part, index) => (
              <div className="operational-part-row" key={index}>
                <strong>{index + 1}</strong>
                <input
                  value={part.partNo}
                  onChange={(event) => onPartChange(index, "partNo", event.target.value)}
                  aria-label={`Part number ${index + 1}`}
                  placeholder="Part number"
                />
                <input
                  value={part.qty}
                  onChange={(event) => onPartChange(index, "qty", event.target.value)}
                  aria-label={`Quantity ${index + 1}`}
                  placeholder="Qty"
                  inputMode="numeric"
                />
                <input
                  value={part.repairOrder}
                  onChange={(event) => onPartChange(index, "repairOrder", event.target.value)}
                  aria-label={`Repair order ${index + 1}`}
                  placeholder="Repair order"
                />
                <button type="button" onClick={() => onRemovePart(index)} disabled={form.parts.length <= 1}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={onAddPart}>Add part</Button>
        </OptionalSection>
      </FormCard>

      <ActionFooter message={message} stickyOnMobile>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Creating..." : "Create workorder"}
        </Button>
      </ActionFooter>
    </OperationalForm>
  );
}
