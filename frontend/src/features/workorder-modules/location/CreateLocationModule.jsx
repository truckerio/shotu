import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { FormField, FormSection } from "../../../components/forms/index.js";
import { AssetLocationCard } from "../../../components/workorders/AssetLocationCard.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function CreateLocationModule({ access, activeSection, errors, form, loadState, locations = [], locale = "en", mapsConfig, onChange, onReload, selectedVehicle }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection id="location" className="create-workorder-card" title={t("create.location.title")} summary={t("create.location.summary")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title={t("create.location.repairLocation")}>
        <FormField id="workorder-location" label={t("create.location.label")} error={errors?.locationId} required requiredLabel={t("create.required")}>
          <Dropdown value={form.locationId} onChange={(event) => onChange(event.target.value)} disabled={loadState?.loading || Boolean(loadState?.error) || !locations.length}>
            <option value="">{loadState?.loading ? t("create.location.loading") : loadState?.error ? t("create.location.unavailable") : locations.length ? t("create.location.select") : t("create.location.none")}</option>
            {locations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
          </Dropdown>
        </FormField>
        {loadState?.error ? <div className="create-location-load-error" role="alert"><span>{t("create.location.loadError")}</span><Button type="button" variant="secondary" onClick={onReload}>{t("create.tryAgain")}</Button></div> : null}
        {selectedVehicle ? <AssetLocationCard vehicle={selectedVehicle} mapsConfig={mapsConfig} locale={locale} showVehicleLabel={false} /> : null}
      </FormSection>
    </ProgressiveWorkorderSection>
  );
}
