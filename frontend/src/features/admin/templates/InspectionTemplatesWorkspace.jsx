import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { createInspectionTemplate, inspectionTemplateSummary, moveInspectionItem, validateInspectionTemplate } from "./inspection-template-model.js";
import "./inspection-templates.css";

function nextId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function saveLabel(status) { return status === "saving" ? "Saving…" : status === "error" ? "Save failed" : "Saved"; }

export function InspectionTemplatesWorkspace({
  templates = [], assignments = [], locations = [], selectedTemplateId, saveStatus = "saved", onArchive, onAssignTemplate, onChange, onPublish, onCreate, onCreateRevision, onRetrySave, onReloadServer, onSelect,
}) {
  const [view, setView] = useState("templates");
  const [compactMode, setCompactMode] = useState("edit");
  const [draft, setDraft] = useState(() => templates[0] || null);
  const selected = useMemo(() => templates.find((item) => item.id === selectedTemplateId) || draft || templates[0] || null, [templates, selectedTemplateId, draft]);
  useEffect(() => { if (selected) setDraft(selected); }, [selectedTemplateId, templates]);

  function update(next) { setDraft(next); onChange?.(next); }
  function choose(template) { setDraft(template); onSelect?.(template.id); }
  function create(presetId) { const template = createInspectionTemplate(presetId, nextId("inspection")); setDraft(template); onCreate?.(template); onSelect?.(template.id); }

  return <section className="inspection-templates" aria-label="Inspection templates">
    <header className="inspection-templates__header">
      <div><p className="inspection-templates__eyebrow">Inspections</p><h2>Templates</h2></div>
      <label className="inspection-templates__create"><span className="sr-only">Create template</span><Dropdown value="" onChange={(event) => { if (event.target.value) create(event.target.value); }}><option value="">Create template</option><option value="weekly-truck">Weekly Truck</option><option value="weekly-trailer">Weekly Trailer</option></Dropdown></label>
    </header>
    <div className="inspection-templates__tabs" role="tablist" aria-label="Inspection administration">
      <button type="button" role="tab" aria-selected={view === "templates"} className={view === "templates" ? "active" : ""} onClick={() => setView("templates")}>Templates</button>
      <button type="button" role="tab" aria-selected={view === "assignments"} className={view === "assignments" ? "active" : ""} onClick={() => setView("assignments")}>Assignments</button>
    </div>
    {view === "assignments" ? <Assignments assignments={assignments} locations={locations} templates={templates} onAssignTemplate={onAssignTemplate} /> : <div className="inspection-templates__content">
      <TemplateCatalog templates={templates} selectedId={selected?.id} onSelect={choose} />
      {selected ? <TemplateEditor template={draft || selected} assignments={assignments} templates={templates} saveStatus={saveStatus} compactMode={compactMode} onArchive={onArchive} onCompactMode={setCompactMode} onChange={update} onPublish={() => onPublish?.(draft || selected)} onCreateRevision={() => onCreateRevision?.(draft || selected)} onRetrySave={onRetrySave} onReloadServer={onReloadServer} /> : <p className="inspection-templates__empty">Choose a weekly preset to begin.</p>}
    </div>}
  </section>;
}

function TemplateCatalog({ templates, selectedId, onSelect }) {
  return <aside className="inspection-template-catalog" aria-label="Template catalog">
    {templates.length ? templates.map((template) => <button type="button" key={template.id} className={template.id === selectedId ? "selected" : ""} onClick={() => onSelect(template)}><span><strong>{template.name}</strong><small>{template.unitType} · {inspectionTemplateSummary(template)}</small></span><em>{template.status === "published" ? "Published" : "Draft"}</em></button>) : <p>No templates yet.</p>}
  </aside>;
}

function Assignments({ assignments, locations, templates, onAssignTemplate }) {
  const [locationId, setLocationId] = useState(""); const [unitType, setUnitType] = useState("Truck"); const [templateVersionId, setTemplateVersionId] = useState("");
  const published = templates.filter((template) => template.status === "published" && template.unitType === unitType);
  const matching = assignments.filter((assignment) => (assignment.locationId || "") === locationId && assignment.applicabilityKey === unitType);
  const ambiguous = matching.length > 1;
  return <div className="inspection-template-assignments">{assignments.map((assignment) => <article key={assignment.id || `${assignment.templateVersionId}-${assignment.locationId || "company"}`}><strong>{assignment.location || "All locations"}</strong><span>{assignment.templateName || "Weekly inspection"}</span><small>{assignment.unitType || "Unit"}</small></article>)}<section className="inspection-template-assignment-recovery" aria-label="Assignment recovery"><h3>Assign a weekly template</h3><p>Choose a company default or a location override. New inspections use this choice; existing inspection snapshots do not change.</p><label>Scope<Dropdown aria-label="Template assignment scope" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Company default</option>{locations.map((location) => <option key={location.id || location.location_id} value={location.id || location.location_id}>{location.name}</option>)}</Dropdown></label><label>Unit type<Dropdown aria-label="Template unit type" value={unitType} onChange={(event) => { setUnitType(event.target.value); setTemplateVersionId(""); }}><option value="Truck">Truck</option><option value="Trailer">Trailer</option></Dropdown></label><label>Published template<Dropdown aria-label="Published inspection template" value={templateVersionId} onChange={(event) => setTemplateVersionId(event.target.value)}><option value="">Select template</option>{published.map((template) => <option key={template.versionId} value={template.versionId}>{template.name}</option>)}</Dropdown></label>{ambiguous ? <p role="alert">This assignment is ambiguous. Reload before changing it.</p> : <Button type="button" disabled={!templateVersionId} onClick={() => onAssignTemplate?.({ locationId: locationId || null, templateVersionId, unitType })}>Save assignment</Button>}</section></div>;
}

function TemplateEditor({ template, assignments, templates, saveStatus, compactMode, onArchive, onCompactMode, onChange, onPublish, onCreateRevision, onRetrySave, onReloadServer }) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [replacement, setReplacement] = useState({});
  const active = assignments.filter((entry) => entry.templateVersionId === template.versionId);
  const candidates = templates.filter((entry) => entry.status === "published" && entry.unitType === template.unitType && entry.versionId !== template.versionId);
  useEffect(() => { setArchiveOpen(false); setArchiveBusy(false); setArchiveError(""); setReplacement({}); }, [template.versionId]);
  async function confirmArchive() {
    setArchiveBusy(true); setArchiveError("");
    try {
      await onArchive?.(template, active.map((assignment) => ({ assignmentId: assignment.id, expectedVersion: assignment.version, replacementVersionId: replacement[assignment.id] })));
    } catch (error) {
      setArchiveError(error.message);
    } finally {
      setArchiveBusy(false);
    }
  }
  const errors = validateInspectionTemplate(template);
  const published = template.status === "published";
  function updateSection(index, patch) { onChange({ ...template, sections: template.sections.map((section, i) => i === index ? { ...section, ...patch } : section) }); }
  function moveSection(index, amount) { onChange({ ...template, sections: moveInspectionItem(template.sections, index, index + amount) }); }
  function updateCheck(sectionIndex, checkIndex, patch) { updateSection(sectionIndex, { checks: template.sections[sectionIndex].checks.map((check, i) => i === checkIndex ? { ...check, ...patch } : check) }); }
  function moveCheck(sectionIndex, checkIndex, amount) { updateSection(sectionIndex, { checks: moveInspectionItem(template.sections[sectionIndex].checks, checkIndex, checkIndex + amount) }); }
  function removeCheck(sectionIndex, checkIndex) { updateSection(sectionIndex, { checks: template.sections[sectionIndex].checks.filter((_, index) => index !== checkIndex) }); }
  return <div className="inspection-template-editor">
    <div className="inspection-template-editor__top"><label>Template name<input disabled={published} value={template.name} onChange={(event) => onChange({ ...template, name: event.target.value })} /></label><span role="status" aria-live="polite" className={`inspection-template-save ${saveStatus}`}>{published ? "Published" : saveLabel(saveStatus)}</span></div>
    <div className="inspection-template-editor__modes" aria-label="Editor mode"><button type="button" className={compactMode === "edit" ? "active" : ""} onClick={() => onCompactMode("edit")}>Edit</button><button type="button" className={compactMode === "preview" ? "active" : ""} onClick={() => onCompactMode("preview")}>Preview</button></div>
    <div className="inspection-template-editor__split">
      <div className={compactMode === "preview" ? "inspection-template-builder is-hidden" : "inspection-template-builder"}>{template.sections.map((section, sectionIndex) => <section key={section.id} className="inspection-template-section"><header><label><span>Section</span><input disabled={published} value={section.title} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} /></label><div><button type="button" aria-label={`Move ${section.title} up`} disabled={published || !sectionIndex} onClick={() => moveSection(sectionIndex, -1)}>↑</button><button type="button" aria-label={`Move ${section.title} down`} disabled={published || sectionIndex === template.sections.length - 1} onClick={() => moveSection(sectionIndex, 1)}>↓</button></div></header>{section.checks.map((check, checkIndex) => <div className="inspection-template-check" key={check.id}><input disabled={published} aria-label={`Check ${checkIndex + 1} in ${section.title}`} value={check.label} onChange={(event) => updateCheck(sectionIndex, checkIndex, { label: event.target.value })} /><span aria-label="Allowed results">Pass · Issue · N/A</span><button type="button" aria-label={`Move ${check.label} up`} disabled={published || !checkIndex} onClick={() => moveCheck(sectionIndex, checkIndex, -1)}>↑</button><button type="button" aria-label={`Move ${check.label} down`} disabled={published || checkIndex === section.checks.length - 1} onClick={() => moveCheck(sectionIndex, checkIndex, 1)}>↓</button><button type="button" aria-label={`Remove ${check.label}`} disabled={published} onClick={() => removeCheck(sectionIndex, checkIndex)}>×</button></div>)}{!published ? <Button onClick={() => updateSection(sectionIndex, { checks: [...section.checks, { id: nextId("check"), label: "New check", allowedResponses: ["pass", "issue", "na"] }] })}>Add check</Button> : null}</section>)}</div>
      <TemplatePreview template={template} hidden={compactMode === "edit"} />
    </div>
    <footer>{published ? <><p>This version is active.</p><Button onClick={onCreateRevision}>Create revision</Button><Button onClick={() => setArchiveOpen(true)}>Archive</Button>{archiveOpen ? <section aria-label="Archive confirmation"><p>{active.length ? "Choose a replacement for every active assignment before archiving." : "Archive this published version? Existing inspections keep their captured version."}</p>{active.map((assignment) => <label key={assignment.id}>Replacement for {assignment.location}<Dropdown aria-label={`Replacement for ${assignment.location}`} value={replacement[assignment.id] || ""} onChange={(event) => setReplacement({ ...replacement, [assignment.id]: event.target.value })}><option value="">Select replacement</option>{candidates.map((candidate) => <option key={candidate.versionId} value={candidate.versionId}>{candidate.name}</option>)}</Dropdown></label>)}{archiveError ? <p className="inspection-template-errors" role="alert">{archiveError}</p> : null}<Button disabled={archiveBusy || active.some((assignment) => !replacement[assignment.id])} onClick={confirmArchive}>{archiveBusy ? "Archiving…" : "Confirm archive"}</Button><Button disabled={archiveBusy} onClick={() => setArchiveOpen(false)}>Cancel</Button></section> : null}</> : saveStatus === "error" ? <><p className="inspection-template-errors">Save failed. Your edits are still here.</p><span className="inspection-template-recovery"><Button onClick={onRetrySave}>Retry</Button><Button onClick={onReloadServer}>Reload</Button></span></> : errors.length ? <p className="inspection-template-errors">{errors[0]}</p> : <p>Ready to publish.</p>}{!published ? <Button variant="primary" disabled={Boolean(errors.length) || saveStatus !== "saved"} onClick={onPublish}>Publish</Button> : null}</footer>
  </div>;
}

function TemplatePreview({ template, hidden }) { return <aside className={hidden ? "inspection-template-preview is-hidden" : "inspection-template-preview"} aria-label="Inspection slip preview"><p>Preview</p><h3>{template.name}</h3><small>{template.unitType} · Pass / Issue / N/A</small>{template.sections.map((section) => <section key={section.id}><strong>{section.title}</strong>{section.checks.map((check) => <div key={check.id}><span>{check.label}</span><i>○ ○ ○</i></div>)}</section>)}</aside>; }
