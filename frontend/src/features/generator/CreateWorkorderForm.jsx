import { FormErrorSummary, OperationalForm } from "../../components/forms/index.js";
import { WorkorderCreateModuleHost } from "../workorder-modules/WorkorderCreateModuleHost.jsx";
import { createWorkorderSummaryErrors } from "./create-workorder-validation.js";

export const CREATE_WORKORDER_FORM_ID = "create-workorder-form";

export function CreateWorkorderForm({
  assignment,
  busy,
  errors,
  errorFocusKey,
  errorFocusReady = true,
  form,
  locationLoadState,
  locations,
  mapsConfig,
  message,
  mobileSection = "location",
  mobileScrollRef,
  onErrorFocusTarget,
  onAddPart,
  onAssignmentChange,
  onFieldChange,
  onLocationChange,
  onReloadLocations,
  onPartChange,
  onRemovePart,
  onSubmit,
  onUnitChange,
  onVehicleSelect,
  sections = [],
  selectedVehicle,
  vehicleLookup,
}) {
  const summaryErrors = createWorkorderSummaryErrors(errors);
  const moduleProps = {
    assignment: { activeSection: mobileSection, assignment, onChange: onAssignmentChange },
    concern: { activeSection: mobileSection, errors, form, onChange: onFieldChange },
    location: {
      activeSection: mobileSection,
      errors,
      form,
      loadState: locationLoadState,
      locations,
      mapsConfig,
      onChange: onLocationChange,
      onReload: onReloadLocations,
      selectedVehicle,
    },
    parts: {
      activeSection: mobileSection,
      errors,
      laborHours: form.laborHours,
      laborProduct: form.laborProduct,
      laborRepairOrder: form.workPerformed,
      locationId: form.locationId,
      parts: form.parts,
      onAdd: onAddPart,
      onChange: onPartChange,
      onLaborHoursChange: (value) => onFieldChange("laborHours", value),
      onRemove: onRemovePart,
    },
    schedule: { activeSection: mobileSection, form, onChange: onFieldChange },
    unit: { activeSection: mobileSection, errors, form, onChange: onFieldChange, onUnitChange, onVehicleSelect, selectedVehicle, vehicleLookup },
  };

  return (
    <OperationalForm ref={mobileScrollRef} id={CREATE_WORKORDER_FORM_ID} className="create-workorder-form" data-mobile-section={mobileSection} busy={busy} onSubmit={onSubmit} noValidate>
      <FormErrorSummary errors={summaryErrors} focusFirstField focusKey={errorFocusKey} focusOnMount focusReady={errorFocusReady} onFocusTarget={onErrorFocusTarget} title="Check the workorder details" />
      {message ? <p className="create-workorder-form-message" role="status">{message}</p> : null}
      <WorkorderCreateModuleHost sections={sections} moduleProps={moduleProps} />
    </OperationalForm>
  );
}
