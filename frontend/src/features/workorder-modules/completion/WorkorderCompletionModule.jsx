import { CheckCircle } from "@untitledui/icons";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { ApproveButton } from "../../../components/workorders/ApproveButton.jsx";
import { WorkDoneButton } from "../../../components/workorders/WorkDoneButton.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { interfaceText } from "../../../i18n/index.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderCompletionModule({
  access,
  activeSection,
  allowedActions = {},
  busy,
  customerSignature,
  message,
  locale = "en",
  isMechanicDetail = false,
  onAccept,
  onApprove,
  onCancel,
  onMarkDone,
  onRequestChanges,
  onSelect,
  workorder,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const text = (key, english) => isMechanicDetail ? t(key) : english;
  const canWrite = writable(access);
  // The API already filters markDone through lifecycle, assignment, role, and
  // module access. Keep that authoritative action visible even if a stale
  // client-side access projection disagrees during a background refresh.
  const canMarkDone = allowedActions.markDone === true;
  const hasWritableActions = canWrite && [
    allowedActions.accept,
    allowedActions.approve,
    allowedActions.returnToMechanic,
    allowedActions.cancel,
  ].some(Boolean);
  const hasActions = canMarkDone || hasWritableActions;
  return (
    <ProgressiveWorkorderSection id="completion" title={text("completion.title", "Completion")} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      <WorkorderHandoffFacts workorder={workorder} locale={isMechanicDetail ? locale : undefined} />
      <dl className="workorder-readonly-details">
        <div><dt>{text("completion.customerAuthorization", "Customer authorization")}</dt><dd>{customerSignature || text("completion.pending", "Pending")}</dd></div>
        <div><dt>{text("completion.authorizedBy", "Authorized by")}</dt><dd>{workorder?.authorizedBy || workorder?.formData?.authorizedBy || text("completion.pendingManager", "Pending Manager approval")}</dd></div>
      </dl>
      {hasActions ? (
        <div className="office-handoff-actions" aria-label={text("completion.actions", "Completion actions")}>
          {canWrite && allowedActions.accept ? <Button type="button" onClick={onAccept} disabled={busy}><CheckCircle />{text("completion.acceptWork", "Accept work")}</Button> : null}
          {canMarkDone ? <WorkDoneButton type="button" onClick={onMarkDone} busy={busy} label={text("completion.workDone", "Work done")} busyLabel={text("completion.submitting", "Submitting")} /> : null}
          {canWrite && allowedActions.approve ? <ApproveButton type="button" onClick={onApprove} busy={busy} /> : null}
          {canWrite && allowedActions.returnToMechanic ? <Button type="button" onClick={onRequestChanges} disabled={busy}>{text("completion.returnMechanic", "Return to mechanic")}</Button> : null}
          {canWrite && allowedActions.cancel ? <Button variant="danger" type="button" onClick={onCancel} disabled={busy}>{text("completion.cancelWorkorder", "Cancel workorder")}</Button> : null}
        </div>
      ) : null}
      {message ? <p className="mechanic-action-message" role="status">{message}</p> : null}
    </ProgressiveWorkorderSection>
  );
}
