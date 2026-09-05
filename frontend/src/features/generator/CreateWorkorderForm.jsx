import { FormErrorSummary, OperationalForm } from "../../components/forms/index.js";
import { WorkorderCreateModuleHost } from "../workorder-modules/WorkorderCreateModuleHost.jsx";
import { createWorkorderSummaryErrors } from "./create-workorder-validation.js";
import { interfaceText } from "../../i18n/index.js";

export const CREATE_WORKORDER_FORM_ID = "create-workorder-form";

const SERIAL_SELECTION_ERROR = {
  en: "Choose one exact serial number for each countable inventory part.",
  es: "Elige un número de serie exacto para cada pieza de inventario contable.",
  pa: "ਹਰ ਗਿਣਤੀ ਵਾਲੇ ਇਨਵੈਂਟਰੀ ਪਾਰਟ ਲਈ ਇੱਕ ਸਹੀ ਸੀਰੀਅਲ ਨੰਬਰ ਚੁਣੋ।",
};

export function CreateWorkorderForm({
  assignment,
  busy,
  errors,
  error,
  errorFocusKey,
  errorFocusReady = true,
  form,
  locationLoadState,
  locations,
  locale = "en",
  mapsConfig,
  message,
  mobileSection = "location",
  mobileScrollRef,
  onErrorFocusTarget,
  onAddPart,
  onAssignmentChange,
  onFieldChange,
  onLocationChange,
  onOpenActiveWorkorder,
  onReloadLocations,
  onPartChange,
  onRemovePart,
  onReplacePartSerializedUnits,
  onSubmit,
  onUnitChange,
  onVehicleSelect,
  sections = [],
  selectedVehicle,
  vehicleLookup,
}) {
  const t = (key) => interfaceText(locale, key);
  const localizedErrors = Object.fromEntries(Object.entries(errors || {}).map(([key, value]) => [
    key,
    key === "parts" && /exact serial/i.test(value)
      ? SERIAL_SELECTION_ERROR[locale] || SERIAL_SELECTION_ERROR.en
      : interfaceText(locale, `create.validation.${key}`) === `create.validation.${key}`
      ? value
      : interfaceText(locale, `create.validation.${key}`),
  ]));
  const summaryErrors = createWorkorderSummaryErrors(localizedErrors);
  const moduleProps = {
    assignment: { activeSection: mobileSection, assignment, locale, onChange: onAssignmentChange },
    concern: { activeSection: mobileSection, errors: localizedErrors, form, locale, onChange: onFieldChange },
    location: {
      activeSection: mobileSection,
      errors: localizedErrors,
      form,
      loadState: locationLoadState,
      locations,
      locale,
      mapsConfig,
      onChange: onLocationChange,
      onReload: onReloadLocations,
      selectedVehicle,
    },
    parts: {
      activeSection: mobileSection,
      errors: localizedErrors,
      locale,
      laborHours: form.laborHours,
      laborProduct: form.laborProduct,
      laborRepairOrder: form.workPerformed,
      locationId: form.locationId,
      parts: form.parts,
      onAdd: onAddPart,
      onChange: onPartChange,
      onLaborHoursChange: (value) => onFieldChange("laborHours", value),
      onLaborRepairOrderChange: (value) => onFieldChange("workPerformed", value),
      onRemove: onRemovePart,
      onReplaceSerializedUnits: onReplacePartSerializedUnits,
    },
    schedule: { activeSection: mobileSection, form, locale, onChange: onFieldChange },
    unit: { activeSection: mobileSection, errors: localizedErrors, form, locale, onChange: onFieldChange, onOpenActiveWorkorder, onUnitChange, onVehicleSelect, selectedVehicle, vehicleLookup },
  };

  return (
    <OperationalForm ref={mobileScrollRef} id={CREATE_WORKORDER_FORM_ID} className="create-workorder-form" data-mobile-section={mobileSection} busy={busy} onSubmit={onSubmit} noValidate>
      <FormErrorSummary errors={summaryErrors} focusFirstField focusKey={errorFocusKey} focusOnMount focusReady={errorFocusReady} onFocusTarget={onErrorFocusTarget} title={t("create.checkDetails")} />
      {message ? <p className="create-workorder-form-message" role={error ? "alert" : "status"}>{message}</p> : null}
      <WorkorderCreateModuleHost sections={sections} moduleProps={moduleProps} />
    </OperationalForm>
  );
}
