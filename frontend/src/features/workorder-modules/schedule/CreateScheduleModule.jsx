import { FormField, FormSection } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function CreateScheduleModule({ access, activeSection, form, locale = "en", onChange }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection id="schedule" className="create-workorder-card" title={t("create.schedule.title")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted showTitle={false}>
      <FormSection title={t("create.schedule.workDates")}><div className="operational-form-grid two">
        <FormField id="workorder-start-date" label={t("create.schedule.startDate")} required requiredLabel={t("create.required")}><input type="date" value={form.workStartDate} onChange={(event) => onChange("workStartDate", event.target.value)} /></FormField>
        <FormField id="workorder-end-date" label={t("create.schedule.endDate")}><input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => onChange("workEndDate", event.target.value)} /></FormField>
      </div></FormSection>
    </ProgressiveWorkorderSection>
  );
}
