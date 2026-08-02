import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { NarrativeField } from "../../../components/forms/NarrativeField.jsx";
import { Button } from "../../../components/ui/Button.jsx";

export function SurveillanceOdooPanel({
  canProcessOdoo,
  controller,
  missing,
  missingInfoHandoff,
  workorder,
}) {
  const {
    markEntered,
    markMissingInfo,
    odooNote,
    odooServiceOrderNo,
    saving,
    setOdooNote,
    setOdooServiceOrderNo,
  } = controller;

  return (
    <div className="surveillance-work-panel">
      <div className="surveillance-copy-grid">
        <div><span>Concern</span><p>{workorder.concern || "-"}</p></div>
        <div><span>Diagnosis</span><p>{workorder.diagnosis || "-"}</p></div>
        <div><span>Work performed</span><p>{workorder.workPerformed || "-"}</p></div>
      </div>
      {canProcessOdoo ? (
        <form className="surveillance-odoo-form" onSubmit={markEntered}>
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
          <label>
            <span>Service order no.</span>
            <input {...textEntryProps("identifier")} value={odooServiceOrderNo} onChange={(event) => setOdooServiceOrderNo(event.target.value)} />
          </label>
          <label>
            <span>Note for Odoo or Manager</span>
            <NarrativeField value={odooNote} onChange={(event) => setOdooNote(event.target.value)} rows="3" placeholder="Required when requesting information" />
          </label>
          <div className="surveillance-odoo-actions">
            <Button variant="primary" type="submit" disabled={saving || !odooServiceOrderNo.trim()}>{saving ? "Saving..." : "Mark entered"}</Button>
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
