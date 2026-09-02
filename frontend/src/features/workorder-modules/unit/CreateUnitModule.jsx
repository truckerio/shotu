import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { useEffect, useId, useState } from "react";
import { CustomerCompanyField, FormField, FormSection, OptionalSection, UnitSummary } from "../../../components/forms/index.js";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";
import {
  activeWorkorderForVehicle,
  moveVehicleSearchResultIndex,
  vehicleSearchResultAction,
} from "../../create-workorder/vehicle-availability-model.js";
import { interfaceText } from "../../../i18n/index.js";

const MAX_VEHICLE_TAGS = 25;
const MAX_VEHICLE_TAG_LENGTH = 120;

export function normalizedVehicleTagNames(tagNames) {
  if (!Array.isArray(tagNames)) return [];
  const seen = new Set();
  return tagNames.slice(0, MAX_VEHICLE_TAGS).reduce((tags, tag) => {
    if (typeof tag !== "string") return tags;
    const normalized = tag.trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || normalized.length > MAX_VEHICLE_TAG_LENGTH || seen.has(key)) return tags;
    seen.add(key);
    tags.push(normalized);
    return tags;
  }, []);
}

export function CreateUnitModule({ access, activeSection, errors, form, locale = "en", onChange, onOpenActiveWorkorder, onUnitChange, onVehicleSelect, selectedVehicle, vehicleLookup }) {
  const [unitDetailsOpen, setUnitDetailsOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [resultsDismissed, setResultsDismissed] = useState(false);
  const resultIdPrefix = useId().replaceAll(":", "");
  const selectedVehicleId = selectedVehicle?.id || selectedVehicle?.provider_vehicle_id || "";
  const vehicleTags = normalizedVehicleTagNames(selectedVehicle?.tag_names);
  const vehicleResults = (vehicleLookup.results || []).slice(0, 6);
  const resultsOpen = !resultsDismissed && vehicleResults.length > 0;
  const t = (key) => interfaceText(locale, key);
  useEffect(() => setUnitDetailsOpen(false), [selectedVehicleId]);
  useEffect(() => {
    setActiveResultIndex(vehicleResults.length ? 0 : -1);
    setResultsDismissed(false);
  }, [vehicleLookup.results]);

  function activateVehicleResult(vehicle) {
    setResultsDismissed(true);
    const action = vehicleSearchResultAction(vehicle);
    if (action.type === "open-workorder") {
      onOpenActiveWorkorder?.(action.workorderId);
      return;
    }
    onVehicleSelect(vehicle);
  }

  function handleUnitKeyDown(event) {
    if (!resultsOpen) return;
    const nextIndex = moveVehicleSearchResultIndex(activeResultIndex, vehicleResults.length, event.key);
    if (nextIndex !== null) {
      event.preventDefault();
      setActiveResultIndex(nextIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setResultsDismissed(true);
      setActiveResultIndex(-1);
      return;
    }
    if (event.key === "Enter" && activeResultIndex >= 0) {
      event.preventDefault();
      activateVehicleResult(vehicleResults[activeResultIndex]);
    }
  }

  if (!access) return null;
  return (
    <ProgressiveWorkorderSection
      id="unit"
      className="create-unit-card"
      title={t("create.unit.title")}
      activeSection={activeSection}
      onSelect={() => {}}
      displayMode="panel"
      keepMounted
      showTitle={false}
    >
      <FormSection
        title={t("create.unit.unit")}
        action={(
          <SectionHelpDisclosure label={t("create.unit.summary")}>
            <p>{t("create.unit.summary")}</p>
            <p>{t("create.unit.searchHelp")}</p>
            <p>{t("create.unit.detailsHelp")}</p>
            <p>{t("create.unit.customerHint")}</p>
          </SectionHelpDisclosure>
        )}
      >
        <div className="operational-unit-lookup">
          <FormField id="workorder-unit" label={t("create.unit.unit")} error={errors?.unitNo} required requiredLabel={t("create.required")}>
            <input {...textEntryProps("search")} role="combobox" aria-autocomplete="list" aria-controls={resultsOpen ? "create-vehicle-suggestions" : undefined} aria-expanded={resultsOpen} aria-activedescendant={resultsOpen && activeResultIndex >= 0 ? `${resultIdPrefix}-vehicle-result-${activeResultIndex}` : undefined} autoComplete="off" enterKeyHint="search" value={form.unitNo} onChange={(event) => { setResultsDismissed(false); setActiveResultIndex(-1); onUnitChange(event.target.value); }} onKeyDown={handleUnitKeyDown} placeholder={t("create.unit.searchPlaceholder")} />
          </FormField>
          {vehicleLookup.loading ? <p className="operational-inline-status">{t("create.unit.searching")}</p> : null}
          {resultsOpen ? <div className="operational-unit-results" id="create-vehicle-suggestions" role="listbox" aria-label={t("create.unit.suggestions")}>{vehicleResults.map((vehicle, index) => {
            const activeWorkorder = activeWorkorderForVehicle(vehicle);
            const statusKey = ({
              accepted: "status.accepted",
              in_progress: "status.inProgress",
              open: "status.open",
              parts_requested: "status.partsRequested",
              waiting_office: "status.waitingOffice",
              work_done: "status.workDone",
            })[activeWorkorder?.status];
            const status = activeWorkorder?.status ? (statusKey ? t(statusKey) : activeWorkorder.status.replaceAll("_", " ")) : "";
            const unitType = ({ truck: t("create.unit.truck"), trailer: t("create.unit.trailer"), other: t("create.unit.other") })[String(vehicle.unit_type || "").toLowerCase()] || vehicle.unit_type;
            const title = vehicle.unit_no || vehicle.name || vehicle.vin || t("create.unit.unnamed");
            const metadata = [unitType, vehicle.license_plate || vehicle.vin, [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
            const workorder = [activeWorkorder?.serial || t("create.unit.activeWorkorder"), status].filter(Boolean).join(" · ");
            return <button key={vehicle.id} id={`${resultIdPrefix}-vehicle-result-${index}`} type="button" role="option" aria-selected={index === activeResultIndex} className={activeWorkorder ? "is-unavailable" : ""} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveResultIndex(index)} onClick={() => activateVehicleResult(vehicle)}><span className="operational-unit-result-main"><strong>{title}</strong>{activeWorkorder ? <span className="operational-unit-workorder">{workorder}</span> : null}</span>{metadata ? <span className="operational-unit-result-meta">{metadata}</span> : null}</button>;
          })}</div> : null}
        </div>
        {selectedVehicle ? <UnitSummary editing={unitDetailsOpen} unit={{ unitNo: form.unitNo, unitType: form.unitType, vehicle: form.model, vin: form.vinNo, license: form.licenseNo, mileage: form.mileage }} onEdit={() => setUnitDetailsOpen((open) => !open)} onFieldChange={onChange} editLabel={unitDetailsOpen ? t("create.unit.doneEditing") : t("create.unit.editDetails")} locale={locale} /> : null}
        {!selectedVehicle ? <OptionalSection title={t("create.unit.details")} open>
          <div className="operational-form-grid two">
            <FormField id="workorder-unit-type" label={t("create.unit.type")}><Dropdown value={form.unitType} onChange={(event) => onChange("unitType", event.target.value)}><option value="">{t("create.unit.selectType")}</option><option value="Truck">{t("create.unit.truck")}</option><option value="Trailer">{t("create.unit.trailer")}</option><option value="Other">{t("create.unit.other")}</option></Dropdown></FormField>
            <FormField id="workorder-license" label={t("create.unit.license")}><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.licenseNo} onChange={(event) => onChange("licenseNo", event.target.value)} /></FormField>
            <FormField id="workorder-mileage" label={t("create.unit.mileage")}><input {...textEntryProps("identifier")} enterKeyHint="next" inputMode="numeric" value={form.mileage} onChange={(event) => onChange("mileage", event.target.value)} /></FormField>
            <FormField id="workorder-model" label={t("create.unit.model")}><input {...textEntryProps("identifier")} enterKeyHint="next" value={form.model} onChange={(event) => onChange("model", event.target.value)} /></FormField>
          </div>
          <FormField id="workorder-vin" label={t("create.unit.vin")}><input {...textEntryProps("identifier")} enterKeyHint="done" value={form.vinNo} onChange={(event) => onChange("vinNo", event.target.value)} /></FormField>
        </OptionalSection> : null}
      </FormSection>
      <FormSection title={t("create.unit.customer")}>
        <CustomerCompanyField value={form.customerCompanyName} onChange={(value) => onChange("customerCompanyName", value)} error={errors?.customerCompanyName} label={t("create.unit.customerCompany")} suggestions={vehicleTags} suggestionsLabel={t("create.unit.vehicleTags")} required requiredLabel={t("create.required")} />
      </FormSection>
    </ProgressiveWorkorderSection>
  );
}
