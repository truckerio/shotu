import { FormField, FormSection } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";

export function CreateScheduleModule({ access, activeSection, form, onChange }) {
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="schedule" className="create-workorder-card" title="Schedule" summary="Set the planned start and end dates." activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <FormSection title="Work dates"><div className="operational-form-grid two">
        <FormField id="workorder-start-date" label="Start date" required><input type="date" value={form.workStartDate} onChange={(event) => onChange("workStartDate", event.target.value)} /></FormField>
        <FormField id="workorder-end-date" label="End date"><input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => onChange("workEndDate", event.target.value)} /></FormField>
      </div></FormSection>
    </ProgressiveWorkorderSection>
  );
}
