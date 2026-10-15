import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { DatePicker } from "../../components/forms/DatePicker.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { emptyDeferral } from "./inspection-maintenance-model.js";

export function InspectionDeferralFields({ value, onChange, unitType = "Truck" }) {
  const policy = value || emptyDeferral();
  const additional = policy.additionalMiles != null;
  function change(key, value, commit = true) { onChange({ ...policy, [key]: value }, commit); }
  return <div className="inspection-deferral-fields">
    <label>Why can this wait?<textarea rows="2" maxLength="2000" value={policy.reason || ""} onChange={event => change("reason", event.target.value, false)} onBlur={() => onChange(policy, true)} /></label>
    <label className="maintenance-checkbox"><Checkbox checked={policy.nextVisit === true} onChange={event => change("nextVisit", event.target.checked)} />Next shop visit</label>
    <label>Review by date <span>Optional</span><DatePicker aria-label="Review by date" value={policy.dueDate || ""} onChange={event => change("dueDate", event.target.value || null)} /></label>
    {unitType !== "Trailer" ? <>
      <label>Mileage trigger<Dropdown aria-label="Mileage trigger" value={additional ? "additional" : policy.dueMiles != null ? "target" : "none"} onChange={event => onChange({ ...policy, dueMiles: event.target.value === "target" ? "" : null, additionalMiles: event.target.value === "additional" ? "" : null, baselineMiles: null }, false)}>
        <option value="none">No mileage trigger</option><option value="target">At odometer reading</option><option value="additional">After additional miles</option>
      </Dropdown></label>
      {additional ? <><label>Confirmed starting miles<input type="number" inputMode="decimal" min="0" step="0.1" value={policy.baselineMiles ?? ""} onChange={event => change("baselineMiles", event.target.value, false)} onBlur={() => onChange(policy, true)} /></label><label>Additional miles<input type="number" inputMode="numeric" min="1" value={policy.additionalMiles ?? ""} onChange={event => change("additionalMiles", event.target.value, false)} onBlur={() => onChange(policy, true)} /></label></> : policy.dueMiles != null ? <label>Due at odometer miles<input type="number" inputMode="decimal" min="0" step="0.1" value={policy.dueMiles} onChange={event => change("dueMiles", event.target.value, false)} onBlur={() => onChange(policy, true)} /></label> : null}
      {additional || policy.dueMiles != null ? <label>Notify this many miles early<input type="number" inputMode="numeric" min="0" max="10000" value={policy.earlyMiles ?? 200} onChange={event => change("earlyMiles", event.target.value, false)} onBlur={() => onChange(policy, true)} /></label> : null}
    </> : null}
    <small>Selected triggers use whichever comes first. Deferring keeps this issue open.</small>
  </div>;
}
