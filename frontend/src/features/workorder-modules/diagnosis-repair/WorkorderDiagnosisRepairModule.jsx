import { FormField, NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";
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
  workPerformed,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.saveNotes);

  return (
    <ProgressiveWorkorderSection
      id="diagnosisRepair"
      title={localeText("detail.diagnosisRepair")}
      headerAction={<SectionHelpDisclosure label={localeText("detail.inspectionAndRepair")}><p>{localeText("detail.diagnosisHint")}</p><p>{localeText("detail.repairHint")}</p></SectionHelpDisclosure>}
      activeSection={activeSection}
      onSelect={onSelect}
      className="mechanic-work-section"
      displayMode="panel"
    >
      {canWrite ? (
        <div className="operational-form detail-workflow-fields">
          <FormField id="mechanic-diagnosis" label={localeText("detail.diagnosis")}>
            <NarrativeField locale={locale} rows="3" value={diagnosis || ""} onChange={(event) => onChange?.("diagnosis", event.target.value)} />
          </FormField>
          <FormField
            id="mechanic-work-performed"
            label={localeText("detail.repairCompleted")}
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
