import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { getVehicleLocation } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { UnitServiceHistory } from "./UnitServiceHistory.jsx";
import { interfaceText, localizedUnitType } from "../../../i18n/index.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

function ReadOnlyUnit({ form, locale, workorder, t }) {
  return (
    <dl className="workorder-readonly-details">
      <div><dt>{t("unit.title")}</dt><dd>{form.unitNo || t("detail.notListed")}</dd></div>
      <div><dt>{t("unit.type")}</dt><dd>{localizedUnitType(form.unitType, locale) || t("detail.notListed")}</dd></div>
      <div><dt>{t("unit.model")}</dt><dd>{form.model || t("detail.notListed")}</dd></div>
      <div><dt>{t("detail.mileage")}</dt><dd>{form.mileage ? `${form.mileage} ${t("unit.milesShort")}` : t("detail.notListed")}</dd></div>
      <div><dt>{t("unit.vin")}</dt><dd>{form.vinNo || t("detail.notListed")}</dd></div>
      <div><dt>{t("unit.license")}</dt><dd>{form.licenseNo || t("detail.notListed")}</dd></div>
      <div><dt>{t("unit.customer")}</dt><dd>{form.customerCompanyName || t("detail.notListed")}</dd></div>
      <div><dt>{t("detail.workorder")}</dt><dd>{workorder?.serial || t("detail.notListed")}</dd></div>
    </dl>
  );
}

export function WorkorderUnitModule({
  access,
  activeWorkorder,
  actorRole,
  detailSection,
  form,
  historyController,
  locale = "en",
  onApplyVehicle,
  onFieldChange,
  onSelect,
  onUnitNumberChange,
  vehicleLookup,
  vehicleMileage,
  vehicleModelText,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const canWrite = writable(access) && Boolean(activeWorkorder.allowedActions?.update);

  return (
    <ProgressiveWorkorderSection
      id="unit"
      title={`${localizedUnitType(form.unitType, locale) || t("unit.title")} ${t("unit.details")}`}
      summary={[form.unitNo, form.customerCompanyName].filter(Boolean).join(" · ") || t("unit.summary")}
      activeSection={detailSection}
      onSelect={onSelect}
      displayMode="panel"
    >
      {canWrite ? (
        <div className="workorder-unit-content">
          <div className="unit-field-wrap">
            <label className="field">
              <span className="field-label-row">{t("unit.number")}</span>
              <input
                {...textEntryProps("search")}
                aria-label={t("unit.number")}
                aria-autocomplete="list"
                aria-controls="vehicle-suggestions"
                aria-expanded={vehicleLookup.results.length > 0}
                role="combobox"
                value={form.unitNo}
                onChange={(event) => onUnitNumberChange(event.target.value)}
                autoComplete="off"
              />
            </label>
            {vehicleLookup.loading ? <p className="vehicle-inline-status">{t("unit.searching")}</p> : null}
            {vehicleLookup.results.length ? (
              <div className="vehicle-results" id="vehicle-suggestions" role="listbox" aria-label={t("unit.suggestions")}>
                {vehicleLookup.results.map((vehicle) => (
                  <button type="button" role="option" aria-selected="false" key={vehicle.id} onClick={() => onApplyVehicle(vehicle)}>
                    <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || t("unit.unnamed")}</strong>
                    <span>{[vehicle.unit_type, vehicle.owner_name, vehicleModelText(vehicle), vehicle.vin, vehicle.license_plate, vehicleMileage(vehicle) ? `${vehicleMileage(vehicle)} ${t("unit.milesShort")}` : "", getVehicleLocation(vehicle) ? t("unit.map") : ""].filter(Boolean).join(" / ")}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="two-col">
            <Field label={t("unit.type")}><Dropdown value={form.unitType} onChange={(event) => onFieldChange("unitType", event.target.value)}><option value="">{t("unit.selectType")}</option><option value="Truck">{t("unit.truck")}</option><option value="Trailer">{t("unit.trailer")}</option><option value="Other">{t("unit.other")}</option></Dropdown></Field>
            <Field label={t("unit.license")}><input {...textEntryProps("identifier")} value={form.licenseNo} onChange={(event) => onFieldChange("licenseNo", event.target.value)} /></Field>
          </div>
          <div className="two-col">
            <Field label={t("detail.mileage")}><input {...textEntryProps("identifier")} value={form.mileage} onChange={(event) => onFieldChange("mileage", event.target.value)} /></Field>
            <Field label={t("unit.model")}><input {...textEntryProps("identifier")} value={form.model} onChange={(event) => onFieldChange("model", event.target.value)} /></Field>
          </div>
          <div className="two-col">
            <Field label={t("unit.customerCompany")}><input {...textEntryProps("name")} value={form.customerCompanyName} onChange={(event) => onFieldChange("customerCompanyName", event.target.value)} /></Field>
            <Field label={t("unit.vinNumber")}><input {...textEntryProps("identifier")} value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} /></Field>
          </div>
          <UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} />
        </div>
      ) : <><ReadOnlyUnit form={form} locale={locale} workorder={activeWorkorder.workorder} t={t} /><UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} /></>}
    </ProgressiveWorkorderSection>
  );
}
