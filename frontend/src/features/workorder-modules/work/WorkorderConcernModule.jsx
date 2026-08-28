import { NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { interfaceText } from "../../../i18n/index.js";

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
  locale = "en",
  isMechanicDetail = false,
  onChange,
  officeNotes,
  onOfficeNotesChange,
  onSave,
  onSelect,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const text = (key, english) => isMechanicDetail ? t(key) : english;
  const canWrite = writable(access) && Boolean(allowedActions.update);

  return (
    <ProgressiveWorkorderSection
      id="concern"
      title={text("detail.concern", "Concern")}
      summary={concern || text("detail.requestedWork", "Requested work")}
      activeSection={activeSection}
      onSelect={onSelect}
      displayMode="panel"
    >
      <div className="workorder-review-content">
        {missingInfoAttention ? (
          <div className="workorder-correction-callout" role="status">
            <strong>{text("detail.infoRequested", "Information requested by Surveillance")}</strong>
            <p>{missingInfoNote}</p>
            <span>{text("detail.addCorrection", "Add the administrative correction or office addendum below, then save changes.")}</span>
          </div>
        ) : null}
        {canWrite ? (
          <>
            <Field label={text("detail.mechanicConcern", "Mechanic concern")}>
              <NarrativeField locale={locale} rows="4" value={concern || ""} onChange={(event) => onChange?.(event.target.value)} />
            </Field>
            <Field label={text("detail.officeNotes", "Office notes")}>
              <NarrativeField locale={locale} rows="3" value={officeNotes || ""} onChange={(event) => onOfficeNotesChange?.(event.target.value)} />
            </Field>
            <Button variant="primary" onClick={onSave} disabled={busy}>
              {busy ? text("detail.saving", "Saving") : text("detail.saveChanges", "Save changes")}
            </Button>
          </>
        ) : (
          <div className="workorder-review-copy"><div><span>{text("detail.requestedWork", "Requested work")}</span><p>{concern || text("detail.noConcern", "No concern recorded.")}</p></div></div>
        )}
        {message ? <p className="mechanic-action-message" role="status">{message}</p> : null}
      </div>
    </ProgressiveWorkorderSection>
  );
}
