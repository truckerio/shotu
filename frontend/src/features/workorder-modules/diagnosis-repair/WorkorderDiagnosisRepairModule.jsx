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
  locale = "en",
  localeText = (value) => value,
  mechanicProgress,
  onChange,
  onSelect,
  validationField = "",
  workPerformed,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.saveNotes);
  const repairRequired = validationField === "workPerformed" && !String(workPerformed || "").trim();

  return (
    <ProgressiveWorkorderSection
      id="diagnosisRepair"
      title={localeText("detail.diagnosisRepair")}
      summary={workPerformed ? localeText("detail.repairDetailsAdded") : localeText("detail.inspectionAndRepair")}
      activeSection={activeSection}
      onSelect={onSelect}
      className="mechanic-work-section"
      displayMode="panel"
    >
      {canWrite ? (
        <div className="operational-form detail-workflow-fields">
          <FormField id="mechanic-diagnosis" label={localeText("detail.diagnosis")} hint={localeText("detail.diagnosisHint")}>
            <NarrativeField locale={locale} rows="3" value={diagnosis || ""} onChange={(event) => onChange?.("diagnosis", event.target.value)} />
          </FormField>
          <FormField
            id="mechanic-work-performed"
            label={localeText("detail.repairCompleted")}
            hint={localeText("detail.repairHint")}
            required={repairRequired}
            error={repairRequired ? localeText("detail.repairRequired") : ""}
            className={repairRequired ? "is-completion-required" : ""}
          >
            <NarrativeField locale={locale} id="mechanic-work-performed" rows="4" value={workPerformed || ""} onChange={(event) => onChange?.("workPerformed", event.target.value)} />
          </FormField>
          {mechanicProgress ? <MechanicProgressStatus status={mechanicProgress.status} error={mechanicProgress.error} localeText={localeText} /> : null}
        </div>
      ) : (
        <dl className="workorder-readonly-details">
          <div><dt>{localeText("detail.diagnosis")}</dt><dd>{diagnosis || localeText("detail.notRecorded")}</dd></div>
          <div><dt>{localeText("detail.workPerformed")}</dt><dd>{workPerformed || localeText("detail.notRecorded")}</dd></div>
        </dl>
      )}
    </ProgressiveWorkorderSection>
  );
}
