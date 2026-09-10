import { useState } from "react";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { CustomerCompanyField, FormField } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { UnitDetailsPopover } from "../../../components/workorders/UnitDetailsPopover.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { UnitServiceHistory } from "./UnitServiceHistory.jsx";
import { normalizedVehicleTagNames } from "./CreateUnitModule.jsx";
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

function ReadOnlyUnitDetails({ form, locale, t }) {
  return <dl className="workorder-readonly-details">
    <div><dt>{t("unit.type")}</dt><dd>{localizedUnitType(form.unitType, locale) || t("detail.notListed")}</dd></div>
    <div><dt>{t("unit.model")}</dt><dd>{form.model || t("detail.notListed")}</dd></div>
    <div><dt>{t("detail.mileage")}</dt><dd>{form.mileage ? `${form.mileage} ${t("unit.milesShort")}` : t("detail.notListed")}</dd></div>
    <div><dt>{t("unit.vin")}</dt><dd>{form.vinNo || t("detail.notListed")}</dd></div>
    <div><dt>{t("unit.license")}</dt><dd>{form.licenseNo || t("detail.notListed")}</dd></div>
  </dl>;
}

export function WorkorderUnitModule({
  access,
  activeWorkorder,
  actorRole,
  detailSection,
  form,
  historyController,
  locale = "en",
  locationContent,
  onApplyVehicle,
  onFieldChange,
  onSelect,
  onUnitNumberCommit,
  onUnitNumberChange,
  presentation = "panel",
  selectedVehicle,
  unitLookupQuery,
  vehicleLookup,
  vehicleMileage,
  vehicleModelText,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const t = (key) => interfaceText(locale, key);
  const canWrite = writable(access) && Boolean(activeWorkorder.allowedActions?.update);
  const vehicleTags = normalizedVehicleTagNames(selectedVehicle?.tag_names || selectedVehicle?.tagNames);
  const onePage = presentation === "one-page";
  if (!access) return null;

  const compactUnit = (
    <div className="workorder-compact-unit-fields">
      <div className="operational-unit-lookup unit-field-wrap">
        <FormField id="workorder-unit" label={t("unit.title")}>
          <output className="workorder-fixed-unit">{form.unitNo || t("detail.notListed")}</output>
        </FormField>
      </div>
      <CustomerCompanyField value={form.customerCompanyName} onChange={(value) => onFieldChange("customerCompanyName", value)} label={onePage ? t("unit.customer") : t("unit.customerCompany")} hint="" suggestions={vehicleTags} suggestionsLabel={t("create.unit.vehicleTags")} />
      <UnitDetailsPopover title={t("unit.details")} open={detailsOpen} onToggle={setDetailsOpen}>
        <div className="operational-form-grid two">
          <FormField id="workorder-unit-type" label={t("unit.type")}><Dropdown value={form.unitType} onChange={(event) => onFieldChange("unitType", event.target.value)}><option value="">{t("unit.selectType")}</option><option value="Truck">{t("unit.truck")}</option><option value="Trailer">{t("unit.trailer")}</option><option value="Other">{t("unit.other")}</option></Dropdown></FormField>
          <FormField id="workorder-license" label={t("unit.license")}><input {...textEntryProps("identifier")} value={form.licenseNo} onChange={(event) => onFieldChange("licenseNo", event.target.value)} /></FormField>
          <FormField id="workorder-mileage" label={t("detail.mileage")}><input {...textEntryProps("identifier")} value={form.mileage} onChange={(event) => onFieldChange("mileage", event.target.value)} /></FormField>
          <FormField id="workorder-model" label={t("unit.model")}><input {...textEntryProps("identifier")} value={form.model} onChange={(event) => onFieldChange("model", event.target.value)} /></FormField>
          <FormField id="workorder-vin" label={t("unit.vinNumber")}><input {...textEntryProps("identifier")} value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} /></FormField>
        </div>
        {locationContent}
        <UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} />
      </UnitDetailsPopover>
    </div>
  );

  return (
    <ProgressiveWorkorderSection
      id="unit"
      title={`${localizedUnitType(form.unitType, locale) || t("unit.title")} ${t("unit.details")}`}
      activeSection={detailSection}
      onSelect={onSelect}
      displayMode="panel"
      showTitle={!onePage}
    >
      {canWrite && onePage ? compactUnit : canWrite ? (
        <div className="workorder-unit-content">
          <div className="unit-field-wrap">
            <FormField id="workorder-unit" label={t("unit.number")}><output className="workorder-fixed-unit">{form.unitNo || t("detail.notListed")}</output></FormField>
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
            <CustomerCompanyField value={form.customerCompanyName} onChange={(value) => onFieldChange("customerCompanyName", value)} label={t("unit.customerCompany")} suggestions={vehicleTags} suggestionsLabel={t("create.unit.vehicleTags")} />
            <Field label={t("unit.vinNumber")}><input {...textEntryProps("identifier")} value={form.vinNo} onChange={(event) => onFieldChange("vinNo", event.target.value)} /></Field>
          </div>
          <UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} />
        </div>
      ) : onePage ? <div className="workorder-compact-unit-fields workorder-compact-unit-readonly"><FormField id="workorder-unit" label={t("unit.title")}><output>{form.unitNo || t("detail.notListed")}</output></FormField><FormField id="customer-company-name" label={t("unit.customer")}><output>{form.customerCompanyName || t("detail.notListed")}</output></FormField><UnitDetailsPopover title={t("unit.details")} open={detailsOpen} onToggle={setDetailsOpen}><ReadOnlyUnitDetails form={form} locale={locale} t={t} />{locationContent}<UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} /></UnitDetailsPopover></div> : <><ReadOnlyUnit form={form} locale={locale} workorder={activeWorkorder.workorder} t={t} />{locationContent}<UnitServiceHistory actorRole={actorRole} historyController={historyController} locale={locale} workorderId={activeWorkorder.workorder?.id} /></>}
    </ProgressiveWorkorderSection>
  );
}
