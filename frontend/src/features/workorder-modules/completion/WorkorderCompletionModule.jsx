import { CheckCircle } from "@untitledui/icons";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { WorkDoneButton } from "../../../components/workorders/WorkDoneButton.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderCompletionModule({
  access,
  activeSection,
  allowedActions = {},
  busy,
  customerSignature,
  onAccept,
  onApprove,
  onCancel,
  onMarkDone,
  onRequestChanges,
  onSelect,
  workorder,
}) {
  if (!access) return null;
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
    <ProgressiveWorkorderSection id="completion" title="Completion" summary={workorder?.endTime ? "Work completed" : "Completion and review"} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      <WorkorderHandoffFacts workorder={workorder} />
      <dl className="workorder-readonly-details">
        <div><dt>Customer authorization</dt><dd>{customerSignature || "Pending"}</dd></div>
        <div><dt>Authorized by</dt><dd>{workorder?.authorizedBy || workorder?.formData?.authorizedBy || "Pending Manager approval"}</dd></div>
      </dl>
      {hasActions ? (
        <div className="office-handoff-actions" aria-label="Completion actions">
          {canWrite && allowedActions.accept ? <Button type="button" onClick={onAccept} disabled={busy}><CheckCircle />Accept work</Button> : null}
          {canMarkDone ? <WorkDoneButton type="button" onClick={onMarkDone} busy={busy} /> : null}
          {canWrite && allowedActions.approve ? <Button variant="primary" type="button" onClick={onApprove} disabled={busy}><CheckCircle />Approve</Button> : null}
          {canWrite && allowedActions.returnToMechanic ? <Button type="button" onClick={onRequestChanges} disabled={busy}>Return to mechanic</Button> : null}
          {canWrite && allowedActions.cancel ? <Button variant="danger" type="button" onClick={onCancel} disabled={busy}>Cancel workorder</Button> : null}
        </div>
      ) : null}
    </ProgressiveWorkorderSection>
  );
}
