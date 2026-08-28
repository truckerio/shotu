import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { formatUiDateRange } from "../../../lib/workorder-presentation.js";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { interfaceText } from "../../../i18n/index.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderScheduleModule({ access, activeSection, allowedActions = {}, endDate, locale, onChange, onSelect, onStartDateChange, startDate, workorder }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale || "en", key);
  const canWrite = writable(access) && Boolean(allowedActions.update);
  const dateRange = formatUiDateRange(startDate, endDate, { locale }) || t("schedule.notScheduled");
  return (
    <ProgressiveWorkorderSection id="schedule" title={t("schedule.title")} summary={dateRange} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {canWrite ? (
        <div className="two-col">
          <Field label={t("schedule.startDate")}><input type="date" value={startDate || ""} onChange={(event) => onStartDateChange?.(event.target.value)} /></Field>
          <Field label={t("schedule.endDate")}><input type="date" value={endDate || ""} min={startDate || undefined} onChange={(event) => onChange?.("workEndDate", event.target.value)} /></Field>
        </div>
      ) : <dl className="workorder-readonly-details"><div><dt>{t("schedule.workDates")}</dt><dd>{dateRange}</dd></div></dl>}
      <WorkorderHandoffFacts workorder={workorder} locale={locale} />
    </ProgressiveWorkorderSection>
  );
}
