import { AssetLocationCard } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderLocationModule({
  access,
  activeSection,
  allowedActions = {},
  location,
  locations = [],
  mapLocation,
  mapsConfig,
  onChange,
  onSelect,
  vehicle,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.update);
  const locationName = location?.name || location?.label || "Not listed";

  return (
    <ProgressiveWorkorderSection id="location" title="Location" summary={locationName} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {canWrite && locations.length ? (
        <Field label="Repair location">
          <select value={location?.id || ""} onChange={(event) => onChange?.(event.target.value)}>
            {locations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
          </select>
        </Field>
      ) : <dl className="workorder-readonly-details"><div><dt>Repair location</dt><dd>{locationName}</dd></div></dl>}
      <AssetLocationCard vehicle={vehicle} location={mapLocation} mapsConfig={mapsConfig} showVehicleLabel={false} />
    </ProgressiveWorkorderSection>
  );
}
