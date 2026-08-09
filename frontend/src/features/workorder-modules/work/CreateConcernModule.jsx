import { FormField, FormSection, NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";

export function CreateConcernModule({ access, activeSection, errors, form, onChange }) {
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="concern" className="create-workorder-card" title="Concern" summary="Describe the requested inspection or repair." activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title="Problem"><FormField id="workorder-concern" label="Mechanic concern" hint="Describe what needs to be inspected or repaired." error={errors?.mechanicConcern} required>
        <NarrativeField rows="4" value={form.mechanicConcern} onChange={(event) => onChange("mechanicConcern", event.target.value)} />
      </FormField></FormSection>
    </ProgressiveWorkorderSection>
  );
}
