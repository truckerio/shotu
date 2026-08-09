import { NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderConcernModule({
  access,
  activeSection,
  activeWorkorder,
  allowedActions = {},
  busy,
  concern,
  message,
  missingInfoAttention,
  missingInfoNote,
  onChange,
  officeNotes,
  onOfficeNotesChange,
  onSave,
  onSelect,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.update);

  return (
    <ProgressiveWorkorderSection
      id="concern"
      title="Concern"
      summary={concern || "Requested work"}
      activeSection={activeSection}
      onSelect={onSelect}
      displayMode="panel"
    >
      <div className="workorder-review-content">
        {missingInfoAttention ? (
          <div className="workorder-correction-callout" role="status">
            <strong>Information requested by Surveillance</strong>
            <p>{missingInfoNote}</p>
            <span>Add the administrative correction or office addendum below, then save changes.</span>
          </div>
        ) : null}
        {canWrite ? (
          <>
            <Field label="Mechanic concern">
              <NarrativeField rows="4" value={concern || ""} onChange={(event) => onChange?.(event.target.value)} />
            </Field>
            <Field label="Office notes">
              <NarrativeField rows="3" value={officeNotes || ""} onChange={(event) => onOfficeNotesChange?.(event.target.value)} />
            </Field>
            <Button variant="primary" onClick={onSave} disabled={busy}>
              {busy ? "Saving" : "Save changes"}
            </Button>
          </>
        ) : (
          <div className="workorder-review-copy"><div><span>Requested work</span><p>{concern || "No concern recorded."}</p></div></div>
        )}
        {message ? <p className="mechanic-action-message" role="status">{message}</p> : null}
      </div>
    </ProgressiveWorkorderSection>
  );
}
