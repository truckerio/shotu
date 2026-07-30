import { useEffect, useState } from "react";
import {
  CustomerCompanyField,
  FormErrorSummary,
  FormField,
  FormSection,
  MechanicMultiSelect,
  NarrativeField,
  OperationalForm,
  OptionalSection,
  QuantityUnitInput,
  UnitSummary,
} from "../../components/forms/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { AssetLocationCard } from "../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../components/workorders/WorkorderObjectPage.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { createWorkorderSummaryErrors } from "./create-workorder-validation.js";

export const CREATE_WORKORDER_FORM_ID = "create-workorder-form";

export function CreateWorkorderForm({
  assignment,
  busy,
  canAssign = true,
  errors,
  errorFocusKey,
  errorFocusReady = true,
  form,
  locations,
  mapsConfig,
  message,
  mobileSection = "work",
  mobileScrollRef,
  onErrorFocusTarget,
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
  const locationOptions = locations || [];
  const selectedVehicleId = selectedVehicle?.id || selectedVehicle?.provider_vehicle_id || "";
  const summaryErrors = createWorkorderSummaryErrors(errors);

  useEffect(() => {
    setUnitDetailsOpen(false);
  }, [selectedVehicleId]);

  return (
    <OperationalForm
      ref={mobileScrollRef}
      id={CREATE_WORKORDER_FORM_ID}
      className="create-workorder-form"
      data-mobile-section={mobileSection}
      busy={busy}
      onSubmit={onSubmit}
      noValidate
    >
      <FormErrorSummary
        errors={summaryErrors}
        focusFirstField
        focusKey={errorFocusKey}
        focusOnMount
        focusReady={errorFocusReady}
        onFocusTarget={onErrorFocusTarget}
        title="Check the workorder details"
      />
      {message ? <p className="create-workorder-form-message" role="status">{message}</p> : null}

      <div className="accordion-stack workorder-progressive-stack create-workorder-progressive-stack">
      <ProgressiveWorkorderSection
        id="work"
        className="create-workorder-card"
        title="Workorder"
        summary="Repair location, schedule, and requested work."
        activeSection={mobileSection}
        onSelect={() => {}}
        displayMode="panel"
        keepMounted
      >
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
            <NarrativeField
              rows="4"
              value={form.mechanicConcern}
              onChange={(event) => onFieldChange("mechanicConcern", event.target.value)}
            />
          </FormField>
        </FormSection>
      </ProgressiveWorkorderSection>

      {canAssign ? (
        <ProgressiveWorkorderSection
          id="assignment"
          className="create-assignment-card"
          title="Assignment"
          summary="Choose the mechanic team for this workorder."
          activeSection={mobileSection}
          onSelect={() => {}}
          displayMode="panel"
          keepMounted
        >
          <div className="create-assignment-content">
            <MechanicMultiSelect
              mechanics={assignment?.mechanics || []}
              selectedIds={assignment?.mechanicUserIds || []}
              onChange={onAssignmentChange}
              disabled={assignment?.loading}
              emptyMessage={assignment?.loading ? "Loading mechanics..." : "No active mechanics at this location."}
              description="Leave the team empty to make this work available for mechanics to accept."
            />
            {!assignment?.mechanicUserIds?.length ? (
              <p className="operational-availability-note">This workorder will appear in the available queue.</p>
            ) : null}
          </div>
        </ProgressiveWorkorderSection>
      ) : null}

      <ProgressiveWorkorderSection
        id="parts"
        className="create-parts-card"
        title="Parts"
        summary="Optional. Record parts already known before work begins."
        activeSection={mobileSection}
        onSelect={() => {}}
        displayMode="panel"
        keepMounted
      >
        <div className="create-known-parts-content">
          {errors?.parts ? <p className="operational-form-field-error" role="alert">{errors.parts}</p> : null}
          <div className="operational-parts-editor">
            {form.parts.map((part, index) => (
              <div className="operational-part-row has-quantity-unit" key={index}>
                <strong>{index + 1}</strong>
                <input
                  {...textEntryProps("identifier")}
                  value={part.partNo}
                  onChange={(event) => onPartChange(index, "partNo", event.target.value)}
                  aria-label={`Part number ${index + 1}`}
                  placeholder="Part number"
                />
                <QuantityUnitInput
                  id={`known-part-quantity-${index}`}
                  quantity={part.qty}
                  uomCode={part.uomCode}
                  onQuantityChange={(value) => onPartChange(index, "qty", value)}
                  onUomCodeChange={(value) => onPartChange(index, "uomCode", value)}
                  quantityLabel={`Quantity ${index + 1}`}
                  unitLabel={`Unit ${index + 1}`}
                  compact
                />
                <input
                  {...textEntryProps("identifier")}
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
        </div>
      </ProgressiveWorkorderSection>

      <ProgressiveWorkorderSection
        id="unit"
        className="create-unit-card"
        title="Unit & customer"
        summary="Select the equipment and confirm who owns or operates it."
        activeSection={mobileSection}
        onSelect={() => {}}
        displayMode="panel"
        keepMounted
      >
        <FormSection title="Unit" description="Search by unit number, VIN, truck name, or license plate.">
        <div className="operational-unit-lookup">
          <FormField id="workorder-unit" label="Unit" error={errors?.unitNo} required>
            <input
              {...textEntryProps("search")}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="create-vehicle-suggestions"
              aria-expanded={Boolean(vehicleLookup.results?.length)}
              autoComplete="off"
              enterKeyHint="search"
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
              editing={unitDetailsOpen}
              unit={{
                unitNo: form.unitNo,
                unitType: form.unitType,
                vehicle: form.model,
                vin: form.vinNo,
                license: form.licenseNo,
                mileage: form.mileage,
              }}
              onEdit={() => setUnitDetailsOpen((open) => !open)}
              onFieldChange={onFieldChange}
              editLabel={unitDetailsOpen ? "Done editing" : "Edit unit details"}
            />
            <AssetLocationCard
              vehicle={selectedVehicle}
              mapsConfig={mapsConfig}
              showVehicleLabel={false}
            />
          </>
        ) : null}

        {!selectedVehicle ? (
          <OptionalSection
            title="Unit details"
            description="Add details when the unit is not available from Samsara."
            open
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
                <input {...textEntryProps("identifier")} enterKeyHint="next" value={form.licenseNo} onChange={(event) => onFieldChange("licenseNo", event.target.value)} />
              </FormField>
              <FormField id="workorder-mileage" label="Mileage">
                <input {...textEntryProps("identifier")} enterKeyHint="next" inputMode="numeric" value={form.mileage} onChange={(event) => onFieldChange("mileage", event.target.value)} />
              </FormField>
              <FormField id="workorder-model" label="Model">
                <input {...textEntryProps("identifier")} enterKeyHint="next" value={form.model} onChange={(event) => onFieldChange("model", event.target.value)} />
              </FormField>
            </div>
            <FormField id="workorder-vin" label="VIN">
              <input {...textEntryProps("identifier")} enterKeyHint="done" value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} />
            </FormField>
          </OptionalSection>
        ) : null}
        </FormSection>

        <FormSection title="Customer">
          <CustomerCompanyField
            value={form.customerCompanyName}
            onChange={(value) => onFieldChange("customerCompanyName", value)}
            error={errors?.customerCompanyName}
            required
          />
        </FormSection>
      </ProgressiveWorkorderSection>
      </div>
    </OperationalForm>
  );
}
