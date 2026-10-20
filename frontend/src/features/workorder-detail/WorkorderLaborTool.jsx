import { useRef, useState } from "react";
import { DatePicker } from "../../components/forms/DatePicker.jsx";
import { Button } from "../../components/ui/Button.jsx";
import {
  laborCorrectionNeedsReason,
  laborEntryCanEdit,
  todayInputValue,
} from "./workorder-work-log-model.js";

function LaborFields({ allowZero = false, draft, onChange, disabled, reasonRequired = false, showReason = false }) {
  return <div className="workorder-labor-fields">
    <label><span>Hours</span><input required type="number" min={allowZero ? "0" : "0.02"} max="24" step="0.01" inputMode="decimal" value={draft.hours} onChange={(event) => onChange("hours", event.target.value)} disabled={disabled} /><small>{allowZero ? "Use 0 to correct a mistaken entry" : "Saved to the nearest minute"}</small></label>
    <label><span>Work date</span><DatePicker required aria-label="Work date" value={draft.date} onChange={(event) => onChange("date", event.target.value)} disabled={disabled} /></label>
    <label className="workorder-labor-note"><span>Note <small>Optional</small></span><input type="text" maxLength="1000" value={draft.note} onChange={(event) => onChange("note", event.target.value)} disabled={disabled} /></label>
    {showReason ? <label className="workorder-labor-reason"><span>Correction reason{reasonRequired ? "" : " (optional)"}</span><textarea required={reasonRequired} rows="2" maxLength="500" value={draft.correctionReason} onChange={(event) => onChange("correctionReason", event.target.value)} disabled={disabled} /></label> : null}
  </div>;
}

function entryDraft(entry) {
  return { hours: String(entry.hours ?? ""), date: entry.date || "", note: entry.note || "", correctionReason: "" };
}

function LaborEntry({ actorId, controller, entry }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => entryDraft(entry));
  const canEdit = laborEntryCanEdit(controller.view, entry, actorId);
  const reasonRequired = laborCorrectionNeedsReason(controller.view, entry, actorId);
  const revisions = Array.isArray(entry.revisions) ? entry.revisions : [];
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  async function save(event) {
    event.preventDefault();
    await controller.editLabor(entry.id, {
      hours: Number(draft.hours), date: draft.date, note: draft.note.trim(),
      expectedVersion: entry.version, correctionReason: draft.correctionReason.trim(),
    });
    setEditing(false);
  }

  return <article className="workorder-labor-entry">
    <div className="workorder-labor-entry-summary">
      <div><strong>{entry.mechanicName || "Mechanic"}</strong><span>{entry.date}</span></div>
      <strong>{Number(entry.hours || 0).toFixed(2)} h</strong>
    </div>
    {entry.note ? <p>{entry.note}</p> : null}
    {editing ? <form onSubmit={(event) => { void save(event).catch(() => {}); }}>
      <LaborFields allowZero draft={draft} onChange={update} disabled={controller.busy} showReason reasonRequired={reasonRequired} />
      <div className="workorder-labor-actions"><Button type="button" onClick={() => { setDraft(entryDraft(entry)); setEditing(false); }} disabled={controller.busy}>Cancel</Button><Button variant="primary" type="submit" disabled={controller.busy || !draft.hours || !draft.date || (reasonRequired && !draft.correctionReason.trim())}>Save correction</Button></div>
    </form> : canEdit ? <Button type="button" onClick={() => setEditing(true)} disabled={controller.busy}>Edit</Button> : null}
    {revisions.length ? <details><summary>Correction history ({revisions.length})</summary><ol>{revisions.map((revision, index) => <li key={`${revision.version}-${revision.changedAt || index}`}><strong>{revision.changedByName || "Staff"}</strong> · {revision.hours} h · {revision.date}{revision.correctionReason ? <span> — {revision.correctionReason}</span> : null}</li>)}</ol></details> : null}
  </article>;
}

export function WorkorderLaborTool({ actorId, controller }) {
  const [draft, setDraft] = useState({ hours: "", date: todayInputValue(), note: "", correctionReason: "" });
  const pendingAddIdRef = useRef("");
  const view = controller.view;
  const update = (field, value) => {
    pendingAddIdRef.current = "";
    setDraft((current) => ({ ...current, [field]: value }));
  };

  async function add(event) {
    event.preventDefault();
    if (!pendingAddIdRef.current) pendingAddIdRef.current = crypto.randomUUID();
    await controller.addLabor({ id: pendingAddIdRef.current, hours: Number(draft.hours), date: draft.date, note: draft.note.trim() });
    pendingAddIdRef.current = "";
    setDraft({ hours: "", date: todayInputValue(), note: "", correctionReason: "" });
  }

  if (!controller.ready) return <div className="workorder-labor-loading" role="status">Loading labor…</div>;
  if (!view) return <div className="workorder-labor-error" role="alert"><p>{controller.error || "Labor is unavailable."}</p><Button type="button" onClick={controller.refresh} disabled={controller.busy}>Try again</Button></div>;

  return <section className="workorder-labor-tool" aria-label="Labor entries">
    <header><div><h4>Labor entries</h4><p>Actual time, attributed to the person who logged it.</p></div><div className="workorder-labor-total"><span>Actual total</span><strong>{view.totalHours.toFixed(2)} h</strong><small>Separate from billed labor</small></div></header>
    {controller.error ? <div className="workorder-labor-error" role="alert"><p>{controller.error}</p><Button type="button" onClick={controller.refresh} disabled={controller.busy}>Refresh</Button></div> : null}
    {view.canLogLabor ? <form className="workorder-labor-add" onSubmit={(event) => { void add(event).catch(() => {}); }}>
      <LaborFields draft={draft} onChange={update} disabled={controller.busy} />
      <Button variant="primary" type="submit" disabled={controller.busy || !draft.hours || !draft.date}>{controller.busy ? "Saving…" : "Add entry"}</Button>
    </form> : null}
    <div className="workorder-labor-list">
      {view.entries.length ? view.entries.map((entry) => <LaborEntry key={`${entry.id}-${entry.version}`} actorId={actorId} controller={controller} entry={entry} />) : <p className="workorder-labor-empty">No labor has been logged.</p>}
    </div>
  </section>;
}
