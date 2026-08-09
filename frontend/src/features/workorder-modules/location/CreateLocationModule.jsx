import { FormField, FormSection } from "../../../components/forms/index.js";
import { AssetLocationCard } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";

export function CreateLocationModule({ access, activeSection, errors, form, loadState, locations = [], mapsConfig, onChange, onReload, selectedVehicle }) {
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="location" className="create-workorder-card" title="Location" summary="Choose where this work will be completed." activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title="Repair location">
        <FormField id="workorder-location" label="Location" error={errors?.locationId} required>
          <select value={form.locationId} onChange={(event) => onChange(event.target.value)} disabled={loadState?.loading || Boolean(loadState?.error) || !locations.length}>
            <option value="">{loadState?.loading ? "Loading locations..." : loadState?.error ? "Locations unavailable" : locations.length ? "Select location" : "No available locations"}</option>
            {locations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
          </select>
        </FormField>
        {loadState?.error ? <div className="create-location-load-error" role="alert"><span>Locations could not be loaded. Try again before creating this workorder.</span><Button type="button" variant="secondary" onClick={onReload}>Try again</Button></div> : null}
        {selectedVehicle ? <AssetLocationCard vehicle={selectedVehicle} mapsConfig={mapsConfig} showVehicleLabel={false} /> : null}
      </FormSection>
    </ProgressiveWorkorderSection>
  );
}
