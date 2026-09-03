import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { InspectionTemplatesWorkspace } from "./InspectionTemplatesWorkspace.jsx";

// Backend integration contract: POST revisions clones an immutable published version into a new draft.
// POST publish atomically persists the supplied draft definition, publishes it, and assigns it.
export const INSPECTION_TEMPLATE_API_CONTRACT = Object.freeze({
  createRevision: "POST /api/admin/inspection-templates/:versionId/revisions { companyId, expectedVersion }",
  publishAtomically: "POST /api/admin/inspection-templates/:versionId/publish { companyId, expectedVersion, definition, assignment }",
});

function fromApi(record) {
  const definition = record.version.definition;
  return {
    id: record.version.id,
    definitionId: record.id,
    versionId: record.version.id,
    optimisticVersion: record.version.optimisticVersion,
    name: record.name,
    unitType: record.applicabilityKey,
    sourcePreset: record.presetKey,
    status: record.version.state,
    sections: (definition.sections || []).map((section) => ({ id: section.key, title: section.title, checks: (section.items || []).map((item) => ({ id: item.key, label: item.label, allowedResponses: ["pass", "issue", "na"] })) })),
  };
}

function definition(template) {
  return {
    familyKey: "inspection",
    presetKey: template.sourcePreset || "custom",
    label: template.name,
    assetType: template.unitType,
    schemaVersion: 1,
    rendererVersion: "inspection-slip-v1",
    sections: template.sections.map((section) => ({ key: section.id, title: section.title, items: section.checks.map((check) => ({ key: check.id, label: check.label, required: true, allowNa: true, requireNaReason: false })) })),
  };
}

export function InspectionTemplatesPage({ actor, locations = [] }) {
  const companies = useMemo(() => [...new Map((locations || []).map((location) => [location.company_id || location.companyId, { id: location.company_id || location.companyId, name: location.company_name || location.companyName || "Company" }]).filter(([id]) => id)).values()], [locations]);
  const [companyId, setCompanyId] = useState("");
  const [templates, setTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [error, setError] = useState("");
  const saveTimer = useRef(null);
  const saveRef = useRef({ inFlight: false, latest: null, promise: Promise.resolve(), versions: new Map() });
  const archiveKeys = useRef(new Map());
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies, companyId]);

  async function load(target = companyId, { preserveDraft = false } = {}) {
    if (!target) return;
    try {
      const result = await api(`/api/admin/inspection-templates?companyId=${encodeURIComponent(target)}`);
      const next = (result.templates || []).map(fromApi);
      next.forEach((template) => saveRef.current.versions.set(template.id, template.optimisticVersion));
      if (preserveDraft && saveRef.current.latest) {
        const local = saveRef.current.latest;
        const server = next.find((item) => item.id === local.id);
        if (server) {
          const preserved = { ...local, optimisticVersion: server.optimisticVersion };
          saveRef.current.latest = preserved;
          setTemplates(next.map((item) => item.id === preserved.id ? preserved : item));
        } else setTemplates(next);
      } else setTemplates(next);
      setAssignments((result.assignments || []).map((entry) => ({ ...entry, unitType: entry.applicabilityKey, location: entry.locationId ? (locations.find((location) => (location.id || location.location_id) === entry.locationId)?.name || "Location") : "All locations" })));
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id || ""); setError("");
    } catch (loadError) { setError(loadError.message); }
  }
  useEffect(() => { load(companyId); }, [companyId]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  async function create(template) {
    try {
      const result = await api("/api/admin/inspection-templates", { method: "POST", body: JSON.stringify({ companyId, name: template.name, applicabilityKey: template.unitType, presetKey: template.sourcePreset, definition: definition(template) }) });
      await load(companyId); setSelectedId(result.version.id);
    } catch (createError) { setError(createError.message); }
  }
  async function flushDraftSave() {
    if (saveRef.current.inFlight) return saveRef.current.promise;
    if (!saveRef.current.latest) return undefined;
    const draft = saveRef.current.latest;
    const expectedVersion = saveRef.current.versions.get(draft.id) || draft.optimisticVersion;
    saveRef.current.inFlight = true;
    const operation = (async () => { try {
      const result = await api(`/api/admin/inspection-templates/${encodeURIComponent(draft.versionId)}?companyId=${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify({ definition: definition(draft), expectedVersion }) });
      saveRef.current.versions.set(draft.id, result.version.optimisticVersion);
      setTemplates((current) => current.map((item) => item.id === draft.id ? { ...item, optimisticVersion: result.version.optimisticVersion } : item));
      if (saveRef.current.latest === draft) saveRef.current.latest = null;
      setSaveStatus("saved"); setError("");
    } catch (saveError) {
      setSaveStatus("error"); setError(saveError.message);
    } finally {
      saveRef.current.inFlight = false;
      if (saveRef.current.latest !== draft) flushDraftSave();
    } })();
    saveRef.current.promise = operation;
    return operation;
  }
  function change(template) {
    setTemplates((current) => current.map((item) => item.id === template.id ? template : item));
    saveRef.current.latest = template;
    if (!saveRef.current.versions.has(template.id)) saveRef.current.versions.set(template.id, template.optimisticVersion);
    setSaveStatus("saving"); window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushDraftSave, 400);
  }
  async function retryLatestSave() { await load(companyId, { preserveDraft: true }); setSaveStatus("saving"); await flushDraftSave(); }
  async function reloadServerVersion() { saveRef.current.latest = null; await load(companyId); setSaveStatus("saved"); }
  async function createRevision(template) {
    try {
      const result = await api(`/api/admin/inspection-templates/${encodeURIComponent(template.versionId)}/revisions`, { method: "POST", body: JSON.stringify({ companyId, expectedVersion: template.optimisticVersion }) });
      await load(companyId); setSelectedId(result.version.id); setSaveStatus("saved"); setError("");
    } catch (revisionError) { setError(revisionError.message); }
  }
  async function publish(template) {
    window.clearTimeout(saveTimer.current);
    try {
      await flushDraftSave();
      const currentAssignment = assignments.find((entry) => !entry.locationId && entry.applicabilityKey === template.unitType);
      const expectedVersion = saveRef.current.versions.get(template.id) || template.optimisticVersion;
      await api(`/api/admin/inspection-templates/${encodeURIComponent(template.versionId)}/publish`, { method: "POST", body: JSON.stringify({ companyId, expectedVersion, definition: definition(template), assignment: { companyId, locationId: null, familyKey: "inspection", applicabilityKey: template.unitType, templateVersionId: template.versionId, expectedVersion: currentAssignment?.version || 0 } }) });
      await load(companyId); setSaveStatus("saved");
    } catch (publishError) { setSaveStatus("error"); setError(publishError.message); }
  }
  async function assign({ locationId, templateVersionId, unitType }) {
    const matches = assignments.filter((entry) => (entry.locationId || null) === (locationId || null) && entry.applicabilityKey === unitType);
    if (matches.length > 1) { setError("This assignment is ambiguous. Reload and choose the intended assignment."); return; }
    try {
      await api("/api/admin/inspection-templates/assignments", { method: "POST", body: JSON.stringify({ companyId, locationId: locationId || null, familyKey: "inspection", applicabilityKey: unitType, templateVersionId, expectedVersion: matches[0]?.version || 0 }) });
      await load(companyId); setError("");
    } catch (assignmentError) { setError(assignmentError.message); }
  }
  async function archive(template, replacements) { const payload={expectedVersion:template.optimisticVersion,replacements};const identity=JSON.stringify([template.versionId,payload]);if(!archiveKeys.current.has(identity))archiveKeys.current.set(identity,`template-archive-${crypto.randomUUID()}`);try{await api(`/api/admin/inspection-templates/${encodeURIComponent(template.versionId)}/archive`,{method:"POST",body:JSON.stringify({companyId,...payload,idempotencyKey:archiveKeys.current.get(identity)})});archiveKeys.current.delete(identity);await load(companyId);setError("");}catch(error){setError(error.message);throw error;} }

  return <section className="admin-content">
    {companies.length > 1 ? <label>Company<Dropdown value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</Dropdown></label> : null}
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    <InspectionTemplatesWorkspace actor={actor} templates={templates} assignments={assignments} locations={locations.filter((location) => (location.company_id || location.companyId) === companyId)} selectedTemplateId={selectedId} saveStatus={saveStatus} onArchive={archive} onAssignTemplate={assign} onChange={change} onPublish={publish} onCreate={create} onCreateRevision={createRevision} onRetrySave={retryLatestSave} onReloadServer={reloadServerVersion} onSelect={setSelectedId} />
  </section>;
}
