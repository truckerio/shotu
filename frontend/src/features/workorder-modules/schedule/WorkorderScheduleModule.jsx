import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { formatUiDateRange } from "../../../lib/workorder-presentation.js";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderScheduleModule({ access, activeSection, allowedActions = {}, endDate, locale, onChange, onSelect, onStartDateChange, startDate, workorder }) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.update);
  const dateRange = formatUiDateRange(startDate, endDate, { locale }) || "Not scheduled";
  return (
    <ProgressiveWorkorderSection id="schedule" title="Schedule" summary={dateRange} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {canWrite ? (
        <div className="two-col">
          <Field label="Start date"><input type="date" value={startDate || ""} onChange={(event) => onStartDateChange?.(event.target.value)} /></Field>
          <Field label="End date"><input type="date" value={endDate || ""} min={startDate || undefined} onChange={(event) => onChange?.("workEndDate", event.target.value)} /></Field>
        </div>
      ) : <dl className="workorder-readonly-details"><div><dt>Work dates</dt><dd>{dateRange}</dd></div></dl>}
      <WorkorderHandoffFacts workorder={workorder} />
    </ProgressiveWorkorderSection>
  );
}
