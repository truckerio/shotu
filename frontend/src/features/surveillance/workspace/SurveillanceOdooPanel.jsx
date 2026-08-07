import { NarrativeField } from "../../../components/forms/NarrativeField.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { odooReadinessStatus } from "./surveillance-workspace-model.js";

function identityLabel(value) {
  return value?.displayName || value?.externalId || "-";
}

export function SurveillanceOdooPanel({
  canProcessOdoo,
  controller,
  missing,
  missingInfoHandoff,
  workorder,
}) {
  const {
    createOdooDraft,
    laborHours,
    markMissingInfo,
    odooDraftResult,
    odooDraftFeedback,
    odooLoading,
    odooNote,
    odooReadiness,
    saving,
    setLaborHours,
    setOdooNote,
  } = controller;
  const createdOrderNo = odooDraftResult?.serviceOrderNo || workorder.odooServiceOrderNo || "";
  const blockers = createdOrderNo ? [] : odooReadiness?.blockers || [];
  const canCreateDraft = Boolean(String(laborHours).trim() && !createdOrderNo);
  const readinessStatus = odooReadinessStatus({
    created: Boolean(createdOrderNo),
    loading: odooLoading,
    readiness: odooReadiness,
  });

  return (
    <div className="surveillance-work-panel">
      <div className="surveillance-copy-grid">
        <div><span>Concern</span><p>{workorder.concern || "-"}</p></div>
        <div><span>Diagnosis</span><p>{workorder.diagnosis || "-"}</p></div>
        <div><span>Work performed</span><p>{workorder.workPerformed || "-"}</p></div>
      </div>
      {canProcessOdoo ? (
        <form className="surveillance-odoo-form" onSubmit={createOdooDraft}>
          {missingInfoHandoff ? (
            <section className="surveillance-handoff-summary" aria-label="Missing information handoff">
              <div>
                <strong>Information requested</strong>
                <span>{missingInfoHandoff.note}</span>
                <small>{missingInfoHandoff.requestedBy}{missingInfoHandoff.requestedAt ? ` · ${new Date(missingInfoHandoff.requestedAt).toLocaleString()}` : ""}</small>
              </div>
              {missingInfoHandoff.managerUpdate ? (
                <div className="has-manager-update">
                  <strong>Manager update received</strong>
                  <span>{missingInfoHandoff.managerUpdate.note}</span>
                  <small>{missingInfoHandoff.managerUpdate.by}{missingInfoHandoff.managerUpdate.at ? ` · ${new Date(missingInfoHandoff.managerUpdate.at).toLocaleString()}` : ""}</small>
                </div>
              ) : <p>Waiting for a Manager correction or addendum.</p>}
            </section>
          ) : null}
          {missing.length ? (
            <div className="surveillance-missing"><strong>Missing information</strong><span>{missing.join(", ")}</span></div>
          ) : <p className="surveillance-complete">Workorder information complete</p>}

          {createdOrderNo ? (
            <section className="surveillance-odoo-result" aria-label="Odoo draft created">
              <strong>Odoo draft created</strong>
              <span>{createdOrderNo}</span>
              {odooDraftResult?.replayed ? <small>Existing draft recovered by workorder marker.</small> : null}
            </section>
          ) : null}

          <section className="surveillance-odoo-readiness" aria-label="Odoo readiness">
            <div>
              <span>Status</span>
              <strong>{readinessStatus}</strong>
            </div>
            <div>
              <span>Customer</span>
              <strong>{identityLabel(odooReadiness?.customer)}</strong>
            </div>
            <div>
              <span>Vehicle</span>
              <strong>{identityLabel(odooReadiness?.vehicle)}</strong>
            </div>
            <div>
              <span>Warehouse</span>
              <strong>{identityLabel(odooReadiness?.warehouse)}</strong>
            </div>
          </section>

          {blockers.length ? (
            <div className="surveillance-odoo-blockers" role="status">
              <strong>Odoo blockers</strong>
              <ul>
                {blockers.map((blocker) => <li key={`${blocker.code}-${blocker.field || ""}`}>{blocker.message}</li>)}
              </ul>
            </div>
          ) : null}

          {odooDraftFeedback ? (
            <div className="surveillance-odoo-attempt" role="alert">
              <strong>Draft not created</strong>
              <span>{odooDraftFeedback}</span>
            </div>
          ) : null}

          <label>
            <span>Labor hours</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              max="999.99"
              step="0.01"
              value={laborHours}
              onChange={(event) => setLaborHours(event.target.value)}
              disabled={Boolean(createdOrderNo)}
            />
          </label>
          <label>
            <span>Note for Odoo or Manager</span>
            <NarrativeField value={odooNote} onChange={(event) => setOdooNote(event.target.value)} rows="3" placeholder="Required when requesting information" />
          </label>
          <div className="surveillance-odoo-actions">
            <Button variant="primary" type="submit" disabled={saving || !canCreateDraft}>{saving ? "Creating..." : "Create Odoo draft"}</Button>
            <Button variant="secondary" type="button" onClick={markMissingInfo} disabled={saving || !odooNote.trim()}>Request information</Button>
          </div>
        </form>
      ) : (
        <div className="surveillance-progress-state">
          <h3>{workorder.status === "mechanic_done" ? "Awaiting office approval" : "Work in progress"}</h3>
          <p>{workorder.status === "mechanic_done"
            ? "The mechanic finished this workorder. It moves to Needs Odoo when office approves it."
            : "This workorder is active. Odoo entry becomes available after the mechanic finishes and office approves it."}</p>
        </div>
      )}
    </div>
  );
}
