import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { AssetLocationCard } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { interfaceText } from "../../../i18n/index.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderLocationModule({
  access,
  activeSection,
  allowedActions = {},
  embedded = false,
  location,
  locations = [],
  mapLocation,
  mapOnly = false,
  mapsConfig,
  locale = "en",
  onChange,
  onSelect,
  presentation = "panel",
  vehicle,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const canWrite = writable(access) && Boolean(allowedActions.update);
  const locationName = location?.name || location?.label || t("detail.notListed");
  const map = <AssetLocationCard vehicle={vehicle} location={mapLocation} mapsConfig={mapsConfig} locale={locale} showVehicleLabel={false} />;
  const locationField = canWrite && locations.length ? (
    <Field label={t("location.repairLocation")}>
      <Dropdown value={location?.id || ""} onChange={(event) => onChange?.(event.target.value)}>
        {locations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
      </Dropdown>
    </Field>
  ) : <dl className="workorder-readonly-details"><div><dt>{t("location.repairLocation")}</dt><dd>{locationName}</dd></div></dl>;

  if (mapOnly) return map;
  if (embedded) return <div id="location" className="workorder-unit-location">{presentation === "one-page" && !(canWrite && locations.length) ? <div className="workorder-one-page-location-readonly"><span>{t("location.title")}</span><span>{locationName}</span></div> : locationField}</div>;

  return (
    <ProgressiveWorkorderSection id="location" title={t("location.title")} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {locationField}
      {map}
    </ProgressiveWorkorderSection>
  );
}
