import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock, Printer } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { formatUiDate } from "../../lib/workorder-presentation.js";
import { inspectionCompletionBlockers, inspectionProgress, inspectionResponseShouldSave, inspectionResult, inspectionResultLabel, inspectionSectionSummary, inspectionStatusLabel, responseIsComplete, weeklyInspectionTemplate } from "./inspection-model.js";
import "./inspections.css";

const choices = [["pass", "Pass"], ["issue", "Issue"], ["na", "N/A"]];
const severities = [["attention", "Attention"], ["repair_required", "Repair required"], ["out_of_service", "Out of service"]];
const dispositions = [["new_workorder", "Workorder required"], ["office_follow_up", "Office follow-up required"], ["no_workorder", "No workorder required"]];

function ReadOnlyResponse({ value = {} }) {
  const response = value.response || "";
  return <div className="inspection-readonly-response">
    <span className={`inspection-response-pill is-${response || "pending"}`}>{response ? choices.find(([key]) => key === response)?.[1] : "Not checked"}</span>
    {response === "issue" ? <div className="inspection-readonly-issue"><strong>{severities.find(([key]) => key === value.severity)?.[1] || "Issue"}</strong>{value.note ? <p>{value.note}</p> : null}{value.disposition ? <small>{dispositions.find(([key]) => key === value.disposition)?.[1]}</small> : null}</div> : null}
    {response === "na" && value.naReason ? <small>{value.naReason}</small> : null}
  </div>;
}

function ChecklistItem({ item, value = {}, editable, onChange }) {
  const response = value.response || "";
  if (!editable) return <div id={`inspection-check-${item.key}`} className={`inspection-check inspection-check-readonly ${response === "issue" ? "has-issue" : ""}`}><strong>{item.label}</strong><ReadOnlyResponse value={value} /></div>;
  return <fieldset id={`inspection-check-${item.key}`} className={`inspection-check ${response === "issue" ? "has-issue" : ""}`}>
    <legend>{item.label}</legend>
    <div className="inspection-response-group" aria-label={`${item.label} response`}>
      {choices.filter(([key]) => key !== "na" || item.naAllowed !== false).map(([key, label]) => <label key={key}><input type="radio" name={item.key} value={key} checked={response === key} onChange={() => onChange({ ...value, response: key })} /><span>{label}</span></label>)}
    </div>
    {response === "issue" ? <div className="inspection-issue-fields">
      <label>Severity<Dropdown aria-label={`${item.label} severity`} value={value.severity || ""} onChange={(event) => onChange({ ...value, severity: event.target.value })}><option value="">Select severity</option>{severities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Dropdown></label>
      <label>What is wrong<textarea value={value.note || ""} onChange={(event) => onChange({ ...value, note: event.target.value }, false)} onBlur={() => onChange(value, true)} rows="2" /></label>
      <label>Disposition<Dropdown aria-label={`${item.label} disposition`} value={value.disposition || ""} onChange={(event) => onChange({ ...value, disposition: event.target.value })}><option value="">Select disposition</option>{dispositions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Dropdown></label>
      {value.disposition === "no_workorder" ? <label>Reason no workorder is needed<input value={value.noWorkorderReason || ""} onChange={(event) => onChange({ ...value, noWorkorderReason: event.target.value }, false)} onBlur={() => onChange(value, true)} /></label> : null}
    </div> : null}
    {response === "na" && item.naReasonRequired ? <label className="inspection-na-reason">Why is this N/A?<input value={value.naReason || ""} onChange={(event) => onChange({ ...value, naReason: event.target.value }, false)} onBlur={() => onChange(value, true)} /></label> : null}
  </fieldset>;
}

export function InspectionDetail({ inspection = {}, projection = "mechanic", mechanics = [], eligibleWorkorders = null, actionError = "", onAssign, onLinkWorkorder, onBack, onResponse, onReload, onComplete, onCreateOrLinkWorkorder, onPrint }) {
  const template = inspection.template || weeklyInspectionTemplate(inspection.unitType);
  const [responses, setResponses] = useState(inspection.responses || {});
  const [saveState, setSaveState] = useState(inspection.saveState || "Saved");
  const [finalNotes, setFinalNotes] = useState(inspection.finalNotes || "");
  const [retryPayload, setRetryPayload] = useState(null);
  const [assignmentId, setAssignmentId] = useState(inspection.mechanic?.id || inspection.mechanicId || "");
  const [workorderId, setWorkorderId] = useState("");
  const [activeSection, setActiveSection] = useState(() => template.sections?.[0]?.key || "");
  const [selectedFindingIds, setSelectedFindingIds] = useState([]);
  const [resolvingWorkorder, setResolvingWorkorder] = useState(false);
  useEffect(() => {
    setResponses(inspection.responses || {});
    setSaveState(inspection.saveState || "Saved");
    setFinalNotes(inspection.finalNotes || "");
    setAssignmentId(inspection.mechanic?.id || inspection.mechanicId || "");
    setRetryPayload(null);
    setActiveSection(template.sections?.find((section) => section.items.some((item) => !responseIsComplete(item, inspection.responses?.[item.key])))?.key || template.sections?.[0]?.key || "");
    setSelectedFindingIds([]);
    setResolvingWorkorder(false);
  }, [inspection.id]);
  const progress = useMemo(() => inspectionProgress(template, responses), [responses, template]);
  const restrictedReadOnly = projection === "read_only";
  const editable = (projection === "mechanic" || projection === "admin") && inspection.status === "in_progress";
  const currentAssignmentId = inspection.mechanic?.id || inspection.mechanicId || "";
  const showChecklist = editable || inspection.status === "completed" || progress.answered > 0;

  async function updateResponse(item, value, commit = true) {
    const next = { ...responses, [item.key]: value };
    setResponses(next);
    if (!inspectionResponseShouldSave(item, value, commit)) { setSaveState("Unsaved"); return; }
    setSaveState("Saving");
    try { await onResponse?.({ itemKey: item.key, value, responses: next }); setSaveState("Saved"); setRetryPayload(null); } catch (error) { setSaveState(error?.message || "Save failed"); setRetryPayload({ item, value }); }
  }
  function nextUnchecked() {
    const section = (template.sections || []).find((entry) => entry.items.some((item) => !responseIsComplete(item, responses[item.key])));
    const item = section?.items.find((entry) => !responseIsComplete(entry, responses[entry.key]));
    if (!item) return;
    setActiveSection(section.key);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`inspection-check-${item.key}`);
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduceMotion) target?.scrollIntoView({ behavior: "auto", block: "center" });
      else target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.querySelector("input")?.focus({ preventScroll: true });
    });
  }
  async function retrySave() { if (retryPayload) await updateResponse(retryPayload.item, retryPayload.value); }
  async function reloadLatest() {
    const latest = await onReload?.();
    if (!latest) return;
    setResponses(latest.responses || {});
    setFinalNotes(latest.finalNotes || "");
    setSaveState("Saved");
  }
  async function assign() { if (!assignmentId) return; await onAssign?.(assignmentId); }
  async function linkFinding(findingId) { if (workorderId) await onLinkWorkorder?.({ findingId, workorderId }); }
  const result = inspectionResult(template, responses);
  const linkedFindingIds = new Set((inspection.workorderLinks || []).map((link) => link.findingId));
  const linkedWorkordersByFinding = new Map((inspection.workorderLinks || []).map((link) => [link.findingId, link]));
  const workorderEligibilityLoading = !Array.isArray(eligibleWorkorders);
  const availableWorkorders = Array.isArray(eligibleWorkorders) ? eligibleWorkorders : [];
  const workorderFindings = Object.values(responses).filter((response) => response.response === "issue" && ["new_workorder", "linked_workorder"].includes(response.disposition) && response.findingId && !linkedFindingIds.has(response.findingId));
  const resolvedWorkorderFindings = Object.values(responses).filter((response) => response.response === "issue" && response.findingId && linkedWorkordersByFinding.has(response.findingId));
  const selectedFindings = workorderFindings.filter((finding) => selectedFindingIds.includes(finding.findingId));
  const completionBlockers = inspectionCompletionBlockers(template, responses, { saveState, unresolvedWorkorderCount: workorderFindings.length });
  const showAssignment = onAssign && (projection === "office" || projection === "admin") && inspection.status !== "completed";
  const showSupportingPane = true;
  function toggleFinding(findingId) {
    setSelectedFindingIds((current) => current.includes(findingId) ? current.filter((id) => id !== findingId) : [...current, findingId]);
  }
  async function createSelectedWorkorder() {
    if (!selectedFindings.length) return;
    const selectedIds = new Set(selectedFindings.map((finding) => finding.findingId));
    const selectedResponses = Object.fromEntries(Object.entries(responses).filter(([, response]) => selectedIds.has(response.findingId)));
    setResolvingWorkorder(true);
    try { await onCreateOrLinkWorkorder?.(selectedResponses); } catch {} finally { setResolvingWorkorder(false); }
  }
  async function linkSelectedFindings() {
    setResolvingWorkorder(true);
    try { for (const finding of selectedFindings) await linkFinding(finding.findingId); } catch {} finally { setResolvingWorkorder(false); }
  }
  return <section className="inspection-detail" aria-label="Inspection detail">
    {onBack ? <Button className="inspection-back" icon={ArrowLeft} type="button" onClick={onBack}>Inspections</Button> : null}
    <header className="inspection-detail-header">
      <div className="inspection-detail-heading"><div><span>{template.label}</span><h1>{inspection.unitNo || "Unit not recorded"}</h1></div><span className={`inspection-status is-${inspection.status || "unknown"}`}>{inspection.status === "completed" && inspection.result ? inspectionResultLabel(inspection.result) : inspectionStatusLabel(inspection.status)}</span></div>
      <dl className="inspection-detail-meta"><div><dt>Inspection</dt><dd>{inspection.number || "Not recorded"}</dd></div><div><dt>Location</dt><dd>{inspection.locationName || "Not recorded"}</dd></div><div><dt>Mechanic</dt><dd>{inspection.mechanicName || "Unassigned"}</dd></div>{inspection.dueAt ? <div><dt>Due</dt><dd>{formatUiDate(inspection.dueAt)}</dd></div> : null}</dl>
    </header>
    <div className={`inspection-detail-layout ${showSupportingPane ? "has-supporting" : ""}`.trim()}>
      <section className="inspection-detail-primary" aria-label="Inspection checklist">
        <div className="inspection-progress" role="status"><div className="inspection-progress-copy"><span><strong>{progress.answered} of {progress.total}</strong> checked</span><span>{progress.issues} issue{progress.issues === 1 ? "" : "s"}</span>{editable ? <span className={`inspection-save-state is-${saveState.toLowerCase().replaceAll(" ", "-")}`}>{saveState}</span> : null}</div><progress value={progress.answered} max={progress.total || 1} aria-label="Inspection completion progress" />{editable && !progress.complete ? <Button type="button" onClick={nextUnchecked}>Next unchecked</Button> : null}</div>
        {restrictedReadOnly && inspection.status !== "completed" ? <p className="inspection-restricted">This inspection is not complete. Checklist details are not available.</p> : !showChecklist ? <section className="inspection-waiting"><Clock aria-hidden="true" /><div><strong>Checklist not started</strong><span>The assigned mechanic will complete the checks here.</span></div></section> : (template.sections || []).map((section) => {
          const sectionProgress = inspectionSectionSummary(section, responses);
          const open = activeSection === section.key;
          const sectionId = `inspection-section-${section.key}`;
          return <section className={`inspection-section ${open ? "is-open" : ""}`.trim()} key={section.key}>
            <button className="inspection-section-trigger" type="button" aria-expanded={open} aria-controls={sectionId} onClick={() => setActiveSection(section.key)}>
              <span><strong>{section.label}</strong><small>{sectionProgress.answered}/{sectionProgress.total} checked{sectionProgress.issues ? ` · ${sectionProgress.issues} issue${sectionProgress.issues === 1 ? "" : "s"}` : ""}</small></span>
              <span className="inspection-section-edit">{open ? "Current section" : sectionProgress.complete ? "Edit" : "Continue"}</span>
            </button>
            <div className="inspection-check-list" id={sectionId} hidden={!open}>{section.items.map((item) => <ChecklistItem key={item.key} item={item} value={responses[item.key]} editable={editable} onChange={(value, commit) => updateResponse(item, value, commit)} />)}</div>
          </section>;
        })}
      </section>
      {showSupportingPane ? <aside className="inspection-detail-support" aria-label="Inspection actions">
        <section className="inspection-summary"><h2>Summary</h2><dl><div><dt>Progress</dt><dd>{progress.answered}/{progress.total} checked</dd></div><div><dt>Issues</dt><dd>{progress.issues}</dd></div><div><dt>Save status</dt><dd className={`inspection-save-state is-${saveState.toLowerCase().replaceAll(" ", "-")}`}>{saveState}</dd></div></dl></section>
        {inspection.officeInstructions && !restrictedReadOnly ? <section className="inspection-office-instructions" aria-label="Office instructions"><strong>Instructions</strong><p>{inspection.officeInstructions}</p></section> : null}
        {showAssignment ? <section className="inspection-assignment"><div><h2>Assignment</h2><p>{inspection.status === "in_progress" ? "Inspection in progress" : "Choose the mechanic responsible for this inspection."}</p></div><Dropdown aria-label="Assign mechanic" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}><option value="">Select mechanic</option>{mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</Dropdown><Button type="button" disabled={!assignmentId || assignmentId === currentAssignmentId} onClick={assign}>{currentAssignmentId ? "Update" : "Assign"}</Button></section> : null}
        {retryPayload ? <section className="inspection-save-recovery" role="alert"><p>{saveState}</p><Button type="button" onClick={retrySave}>Retry save</Button><Button type="button" onClick={reloadLatest}>Reload latest</Button></section> : null}
        {editable ? <>
          <section className="inspection-findings"><div><h2>Findings &amp; workorders</h2><p>{workorderFindings.length > 0 ? "Resolve every selected issue before completing this inspection." : "No workorder-required findings."}</p></div>{actionError ? <p className="inspection-action-error" role="alert">{actionError}</p> : null}{resolvedWorkorderFindings.map((finding, index) => { const linked = linkedWorkordersByFinding.get(finding.findingId); return <div className="inspection-resolved-finding" key={finding.findingId}><span><strong>Resolved issue {index + 1}</strong><small>{finding.note || "Finding"}</small></span><span><strong>{linked.workorderSerial || "Linked workorder"}</strong>{linked.workorderStatus ? <small>{linked.workorderStatus}</small> : null}</span></div>; })}{workorderFindings.map((finding, index) => <label className="inspection-finding-card" key={finding.findingId}><input type="checkbox" disabled={resolvingWorkorder || workorderEligibilityLoading} checked={selectedFindingIds.includes(finding.findingId)} onChange={() => toggleFinding(finding.findingId)} /><span><strong>Issue {index + 1}</strong><small>{finding.note || "Finding details pending"}</small></span></label>)}{workorderFindings.length > 0 && workorderEligibilityLoading ? <p className="inspection-link-guidance" role="status">Checking active workorders…</p> : null}{workorderFindings.length > 0 && availableWorkorders.length > 0 && onLinkWorkorder ? <div className="inspection-link-workorder"><p className="inspection-link-guidance">An active workorder already exists for this unit. Link the selected findings to it.</p><Dropdown aria-label="Existing workorder" value={workorderId} onChange={(event) => setWorkorderId(event.target.value)}><option value="">Select workorder</option>{availableWorkorders.map((workorder) => <option key={workorder.id} value={workorder.id}>{workorder.serial}</option>)}</Dropdown><Button type="button" disabled={resolvingWorkorder || !workorderId || !selectedFindings.length} onClick={linkSelectedFindings}>{resolvingWorkorder ? "Linking issues…" : "Link selected issues"}</Button></div> : null}{workorderFindings.length > 0 && !workorderEligibilityLoading && availableWorkorders.length === 0 && onCreateOrLinkWorkorder ? <Button type="button" disabled={resolvingWorkorder || !selectedFindings.length} onClick={createSelectedWorkorder}>{resolvingWorkorder ? "Creating workorder…" : `Create workorder for ${selectedFindings.length || "selected"} issue${selectedFindings.length === 1 ? "" : "s"}`}</Button> : null}{workorderFindings.length > 0 && !workorderEligibilityLoading && ((availableWorkorders.length > 0 && !onLinkWorkorder) || (availableWorkorders.length === 0 && !onCreateOrLinkWorkorder)) ? <p className="inspection-resolution-unavailable">Office must resolve these findings before this inspection can be completed.</p> : null}</section>
          <section className="inspection-completion"><h2>Complete inspection</h2><label>Notes<textarea rows="3" value={finalNotes} onChange={(event) => setFinalNotes(event.target.value)} /></label>{completionBlockers.length ? <ul className="inspection-completion-blockers" aria-live="polite">{completionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>Result: {inspectionResultLabel(result)}</p>}<Button variant="primary" type="button" disabled={completionBlockers.length > 0} onClick={() => onComplete?.({ responses, result, finalNotes })}>Complete inspection</Button></section>
        </> : null}
        {!editable && inspection.finalNotes ? <section className="inspection-final-notes"><h2>Notes</h2><p>{inspection.finalNotes}</p></section> : null}
        {!editable && inspection.status === "completed" && onPrint ? <Button className="inspection-print" icon={Printer} type="button" onClick={onPrint}>Print slip</Button> : null}
      </aside> : null}
    </div>
  </section>;
}
