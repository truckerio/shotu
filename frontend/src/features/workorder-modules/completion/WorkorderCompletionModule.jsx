import { CheckCircle } from "@untitledui/icons";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
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
  const hasActions = canWrite && Object.values(allowedActions).some(Boolean);
  return (
    <ProgressiveWorkorderSection id="completion" title="Completion" summary={workorder?.endTime ? "Work completed" : "Completion and review"} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      <WorkorderHandoffFacts workorder={workorder} />
      <dl className="workorder-readonly-details">
        <div><dt>Customer authorization</dt><dd>{customerSignature || "Pending"}</dd></div>
        <div><dt>Authorized by</dt><dd>{workorder?.authorizedBy || workorder?.formData?.authorizedBy || "Pending Manager approval"}</dd></div>
      </dl>
      {hasActions ? (
        <div className="office-handoff-actions" aria-label="Completion actions">
          {allowedActions.accept ? <Button type="button" onClick={onAccept} disabled={busy}><CheckCircle />Accept work</Button> : null}
          {allowedActions.markDone ? <Button variant="primary" type="button" onClick={onMarkDone} disabled={busy}><CheckCircle />Work done</Button> : null}
          {allowedActions.approve ? <Button variant="primary" type="button" onClick={onApprove} disabled={busy}><CheckCircle />Approve</Button> : null}
          {allowedActions.returnToMechanic ? <Button type="button" onClick={onRequestChanges} disabled={busy}>Return to mechanic</Button> : null}
          {allowedActions.cancel ? <Button variant="danger" type="button" onClick={onCancel} disabled={busy}>Cancel workorder</Button> : null}
        </div>
      ) : null}
    </ProgressiveWorkorderSection>
  );
}
