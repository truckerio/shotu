import { FormField, NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { MechanicProgressStatus } from "../../mechanic/progress/MechanicProgressStatus.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderDiagnosisRepairModule({
  access,
  activeSection,
  allowedActions = {},
  diagnosis,
  localeText = (value) => value,
  mechanicProgress,
  onChange,
  onSelect,
  workPerformed,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.saveNotes);

  return (
    <ProgressiveWorkorderSection
      id="diagnosisRepair"
      title="Diagnosis and repair"
      summary={workPerformed ? "Repair details added" : "Inspection findings and completed repair"}
      activeSection={activeSection}
      onSelect={onSelect}
      className="mechanic-work-section"
      displayMode="panel"
    >
      {canWrite ? (
        <div className="operational-form detail-workflow-fields">
          <FormField id="mechanic-diagnosis" label={localeText("detail.diagnosis")} hint="What did you inspect or find?">
            <NarrativeField rows="3" value={diagnosis || ""} onChange={(event) => onChange?.("diagnosis", event.target.value)} />
          </FormField>
          <FormField id="mechanic-work-performed" label={localeText("detail.repairCompleted")} hint="Write what was repaired, replaced, adjusted, or checked.">
            <NarrativeField id="mechanic-work-performed" rows="4" value={workPerformed || ""} onChange={(event) => onChange?.("workPerformed", event.target.value)} />
          </FormField>
          {mechanicProgress ? <MechanicProgressStatus status={mechanicProgress.status} error={mechanicProgress.error} /> : null}
        </div>
      ) : (
        <dl className="workorder-readonly-details">
          <div><dt>Diagnosis</dt><dd>{diagnosis || "Not recorded"}</dd></div>
          <div><dt>Work performed</dt><dd>{workPerformed || "Not recorded"}</dd></div>
        </dl>
      )}
    </ProgressiveWorkorderSection>
  );
}
