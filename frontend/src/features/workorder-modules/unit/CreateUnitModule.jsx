import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { useEffect, useState } from "react";
import { CustomerCompanyField, FormField, FormSection, OptionalSection, UnitSummary } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { activeWorkorderForVehicle, vehicleCanBeSelected } from "../../create-workorder/vehicle-availability-model.js";
import { interfaceText } from "../../../i18n/index.js";

export function CreateUnitModule({ access, activeSection, errors, form, locale = "en", onChange, onUnitChange, onVehicleSelect, selectedVehicle, vehicleLookup }) {
  const [unitDetailsOpen, setUnitDetailsOpen] = useState(false);
  const selectedVehicleId = selectedVehicle?.id || selectedVehicle?.provider_vehicle_id || "";
  const t = (key) => interfaceText(locale, key);
  useEffect(() => setUnitDetailsOpen(false), [selectedVehicleId]);
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="unit" className="create-unit-card" title={t("create.unit.title")} summary={t("create.unit.summary")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title={t("create.unit.unit")} description={t("create.unit.searchHelp")}>
        <div className="operational-unit-lookup">
          <FormField id="workorder-unit" label={t("create.unit.unit")} error={errors?.unitNo} required requiredLabel={t("create.required")}>
            <input {...textEntryProps("search")} role="combobox" aria-autocomplete="list" aria-controls="create-vehicle-suggestions" aria-expanded={Boolean(vehicleLookup.results?.length)} autoComplete="off" enterKeyHint="search" value={form.unitNo} onChange={(event) => onUnitChange(event.target.value)} placeholder={t("create.unit.searchPlaceholder")} />
          </FormField>
          {vehicleLookup.loading ? <p className="operational-inline-status">{t("create.unit.searching")}</p> : null}
          {vehicleLookup.results?.length ? <div className="operational-unit-results" id="create-vehicle-suggestions" role="listbox" aria-label={t("create.unit.suggestions")}>{vehicleLookup.results.map((vehicle) => {
            const unavailable = !vehicleCanBeSelected(vehicle);
            const activeWorkorder = activeWorkorderForVehicle(vehicle);
            const serial = activeWorkorder?.serial || t("create.unit.activeWorkorder");
            const statusKey = ({
              accepted: "status.accepted",
              in_progress: "status.inProgress",
              open: "status.open",
              parts_requested: "status.partsRequested",
              waiting_office: "status.waitingOffice",
              work_done: "status.workDone",
            })[activeWorkorder?.status];
            const status = activeWorkorder?.status ? ` (${statusKey ? t(statusKey) : activeWorkorder.status.replaceAll("_", " ")})` : "";
            const unitType = ({ truck: t("create.unit.truck"), trailer: t("create.unit.trailer"), other: t("create.unit.other") })[String(vehicle.unit_type || "").toLowerCase()] || vehicle.unit_type;
            return <button key={vehicle.id} type="button" role="option" aria-selected="false" disabled={unavailable} onClick={() => onVehicleSelect(vehicle)}><strong>{vehicle.unit_no || vehicle.name || vehicle.vin || t("create.unit.unnamed")}</strong><span>{[unitType, vehicle.owner_name, [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "), vehicle.vin, vehicle.license_plate].filter(Boolean).join(" / ")}</span>{unavailable ? <span className="operational-unit-unavailable">{t("create.unit.alreadyHas")} {serial}{status}. {t("create.unit.closeBeforeAnother")}</span> : null}</button>;
          })}</div> : null}
        </div>
        {selectedVehicle ? <UnitSummary editing={unitDetailsOpen} unit={{ unitNo: form.unitNo, unitType: form.unitType, vehicle: form.model, vin: form.vinNo, license: form.licenseNo, mileage: form.mileage }} onEdit={() => setUnitDetailsOpen((open) => !open)} onFieldChange={onChange} editLabel={unitDetailsOpen ? t("create.unit.doneEditing") : t("create.unit.editDetails")} locale={locale} /> : null}
        {!selectedVehicle ? <OptionalSection title={t("create.unit.details")} description={t("create.unit.detailsHelp")} open>
          <div className="operational-form-grid two">
            <FormField id="workorder-unit-type" label={t("create.unit.type")}><Dropdown value={form.unitType} onChange={(event) => onChange("unitType", event.target.value)}><option value="">{t("create.unit.selectType")}</option><option value="Truck">{t("create.unit.truck")}</option><option value="Trailer">{t("create.unit.trailer")}</option><option value="Other">{t("create.unit.other")}</option></Dropdown></FormField>
            <FormField id="workorder-license" label={t("create.unit.license")}><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.licenseNo} onChange={(event) => onChange("licenseNo", event.target.value)} /></FormField>
            <FormField id="workorder-mileage" label={t("create.unit.mileage")}><input {...textEntryProps("identifier")} enterKeyHint="next" inputMode="numeric" value={form.mileage} onChange={(event) => onChange("mileage", event.target.value)} /></FormField>
            <FormField id="workorder-model" label={t("create.unit.model")}><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.model} onChange={(event) => onChange("model", event.target.value)} /></FormField>
          </div>
          <FormField id="workorder-vin" label={t("create.unit.vin")}><input {...textEntryProps("identifier")} enterKeyHint="done" value={form.vinNo} onChange={(event) => onChange("vinNo", event.target.value)} /></FormField>
        </OptionalSection> : null}
      </FormSection>
      <FormSection title={t("create.unit.customer")}><CustomerCompanyField value={form.customerCompanyName} onChange={(value) => onChange("customerCompanyName", value)} error={errors?.customerCompanyName} label={t("create.unit.customerCompany")} hint={t("create.unit.customerHint")} required requiredLabel={t("create.required")} /></FormSection>
    </ProgressiveWorkorderSection>
  );
}
