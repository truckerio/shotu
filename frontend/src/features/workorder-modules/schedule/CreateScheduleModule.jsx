import { FormField, FormSection } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function CreateScheduleModule({ access, activeSection, form, locale = "en", onChange, presentation = "panel" }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const onePage = presentation === "one-page";
  const dates = onePage ? (
    <div className="create-schedule-one-page-fields">
      <span className="create-schedule-one-page-label">{t("create.schedule.workDates")}</span>
      <div className="create-schedule-one-page-range">
        <label>
          <span className="operational-sr-only">{t("create.schedule.startDate")}</span>
          <input id="workorder-start-date" type="date" value={form.workStartDate} required onChange={(event) => onChange("workStartDate", event.target.value)} />
        </label>
        <span className="create-schedule-one-page-separator" aria-hidden="true">→</span>
        <label>
          <span className="operational-sr-only">{t("create.schedule.endDate")}</span>
          <input id="workorder-end-date" type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => onChange("workEndDate", event.target.value)} />
        </label>
      </div>
    </div>
  ) : <FormSection title={t("create.schedule.workDates")}><div className="operational-form-grid two">
    <FormField id="workorder-start-date" label={t("create.schedule.startDate")} required requiredLabel={t("create.required")}><input type="date" value={form.workStartDate} onChange={(event) => onChange("workStartDate", event.target.value)} /></FormField>
    <FormField id="workorder-end-date" label={t("create.schedule.endDate")}><input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => onChange("workEndDate", event.target.value)} /></FormField>
  </div></FormSection>;
  return (
    <ProgressiveWorkorderSection id="schedule" className={`create-workorder-card${onePage ? " create-schedule-one-page" : ""}`} title={t("create.schedule.title")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted showTitle={false}>
      {dates}
    </ProgressiveWorkorderSection>
  );
}
