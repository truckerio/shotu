export const CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED = "CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED";

export class WorkorderLifecycleConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkorderLifecycleConflictError";
    this.statusCode = 409;
    this.code = code;
  }
}

function revisedEstimateConflict() {
  return new WorkorderLifecycleConflictError(
    CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED,
    "The customer must accept the current revised Estimate before repair work can continue.",
  );
}

export function isRepairProgressMutation(before, input) {
  const hasTopLevelLaborHours = Object.prototype.hasOwnProperty.call(input || {}, "laborHours");
  const hasNestedLaborHours = Object.prototype.hasOwnProperty.call(input?.formData || {}, "laborHours");
  const requestedLaborHours = hasTopLevelLaborHours
    ? input.laborHours
    : input?.formData?.laborHours;
  return (
    Object.prototype.hasOwnProperty.call(input || {}, "diagnosis")
      && input.diagnosis !== before?.diagnosis
  ) || (
    Object.prototype.hasOwnProperty.call(input || {}, "workPerformed")
      && input.workPerformed !== before?.work_performed
  ) || (
    (hasTopLevelLaborHours || hasNestedLaborHours)
      && String(requestedLaborHours ?? "") !== String(before?.form_data?.laborHours ?? "")
  );
}

/**
 * Call only inside the mutation transaction after locking the Workorder row.
 * This keeps the authorization decision and repair-progress write serialized
 * against every other canonical Workorder mutation.
 */
export async function assertCurrentExternalEstimateAccepted(client, { companyId, workorderId }) {
  const result = await client.query(
    `select auth_event.classification,
            latest.id latest_revision_id,
            exists (
              select 1 from customer_document_events accepted
               where accepted.company_id=auth_event.company_id
                 and accepted.revision_id=latest.id
                 and accepted.event_type='accepted'
            ) latest_accepted,
            exists (
              select 1 from customer_document_events terminal
               where terminal.company_id=auth_event.company_id
                 and terminal.revision_id=latest.id
                 and terminal.event_type in ('declined','changes_requested','voided','superseded')
            ) latest_terminal
       from lateral (
         select event.company_id,event.workorder_id,event.classification
           from workorder_authorization_events event
          where event.company_id=$1 and event.workorder_id=$2
          order by event.created_at desc,event.id desc limit 1
       ) auth_event
       left join lateral (
         select revision.id
           from customer_documents document
           join customer_document_revisions revision
             on revision.company_id=document.company_id and revision.document_id=document.id
          where document.company_id=auth_event.company_id
            and document.workorder_id=auth_event.workorder_id
            and document.document_type='estimate'
          order by revision.revision_number desc,revision.id desc limit 1
       ) latest on true`,
    [companyId, workorderId],
  );
  const authorization = result.rows[0];
  if (authorization?.classification === "required_external_customer"
    && (!authorization.latest_revision_id
      || authorization.latest_accepted !== true
      || authorization.latest_terminal === true)) {
    throw revisedEstimateConflict();
  }
}
