import { createHash, randomUUID } from "node:crypto";
import { INSPECTION_REQUIRED_CAPABILITIES } from "./inspection-config.js";
import { createInspectionSchema } from "../../../src/server/modules/inspections/inspection.schemas.js";

export const INSPECTION_WORKFLOW_STEPS = Object.freeze(["admin-template-and-module", "office-request-and-assign", "mechanic-start-save-interrupt-resume", "mechanic-issue-workorder-complete", "summary-link-back", "read-only-slip", "print", "follow-up", "correction", "reinspection"]);

function inspectionFrom(result, stage) { const inspection = result.body?.inspection; if (!inspection?.id) throw new Error(`${stage} did not return an inspection.`); return inspection; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function validateArchivedPdf(archive, bytes) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Inspection print archive download is not a PDF.");
  if (archive.documentSha256 && archive.documentSha256 !== sha256(bytes)) throw new Error("Inspection print archive PDF digest does not match archive metadata.");
  if (archive.documentByteSize != null && archive.documentByteSize !== bytes.length) throw new Error("Inspection print archive PDF byte size does not match archive metadata.");
}
export function validateReinspectionRecord(inspection, predecessorId) {
  if ((inspection.responses || []).length || inspection.lineage?.kind !== "reinspection" || inspection.lineage?.predecessorInspectionId !== predecessorId) throw new Error("Reinspection did not start blank with typed correction lineage.");
}
export function startPayload(inspection) {
  const payload = { expectedVersion: inspection.version, previousReportReviewed:Boolean(inspection.previousReportAvailable) };
  if (String(inspection.unitType || "").toLowerCase() !== "trailer") {
    payload.odometerMiles = 124500;
    payload.engineHours = 2500.5;
    payload.previousReportReviewed = Boolean(inspection.previousReportAvailable);
  }
  return payload;
}
export function inspectionCreatePayload({ location, assetId, mechanicUserId, label }) {
  const payload = { companyId: location.companyId, locationId: location.id, assetId, mechanicUserIds: [mechanicUserId], officeInstructions: label, idempotencyKey: `qa-inspection-create-${randomUUID()}` };
  const parsed = createInspectionSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`QA inspection create fixture is invalid: ${parsed.error.issues[0]?.message || "schema failure"}`);
  return parsed.data;
}
function itemResponses(inspection) {
  const items = (inspection.templateSnapshot?.sections || []).flatMap((section) => section.items || []);
  if (!items.length) throw new Error("Inspection template snapshot has no checklist items.");
  if (items.length < 2) throw new Error("QA inspection template needs two checklist items for repair and Office follow-up coverage.");
  return items.map((item, index) => ({ itemKey: item.key, response: index < 2 ? "issue" : "pass", ...(index === 0 ? { finding: { severity: "repair_required", note: "QA inspection workflow repair finding.", disposition: "new_workorder", noWorkorderReason: "" } } : index === 1 ? { finding: { severity: "attention", note: "QA inspection Office follow-up finding.", disposition: "office_follow_up", noWorkorderReason: "" } } : {}) }));
}
export function requiredCapabilityHook(capability) {
  if (!INSPECTION_REQUIRED_CAPABILITIES.includes(capability)) throw new Error(`Unknown inspection capability ${capability}.`);
  return true;
}

export async function runApiInspectionWorkflow({ clients, config, createClient, logger = console, onWorkorderFixture = () => {} }) {
  const trace = []; const record = (stage, detail = {}) => { trace.push({ stage, ...detail }); logger.log(`[inspection-workflow] ${stage}`); };
  const actors = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([role, client]) => [role, await client.authenticate(config.accounts[role])] )));
  const createContext = await clients.office.request(`/api/inspections/create-context?locationId=${encodeURIComponent(actors.office.locationIds?.[0] || "")}&search=QA`);
  const location = (createContext.body?.locations || []).find((entry) => entry.name === config.locationName);
  if (!location) throw new Error("Configured QA location is not writable for Office inspection testing.");
  record("admin-template-and-module", { pending: "Admin UI exercised by browser phase; API fixture uses the published assignment." });
  const fixtureLabel = `QA ${config.evidenceNamespace} daily-life inspection`;
  const created = await clients.office.request("/api/inspections", { method: "POST", body: inspectionCreatePayload({ location, assetId: config.fixtures.truckAssetId, mechanicUserId: actors.mechanic.id, label: `${fixtureLabel} truck` }), expectedStatuses: [201] });
  let inspection = inspectionFrom(created, "office request"); record("office-request-and-assign", { inspectionId: inspection.id });
  const started = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/actions/start`, { method: "POST", body: startPayload(inspection) }); inspection = inspectionFrom(started, "mechanic start");
  const firstSave = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/responses`, { method: "PATCH", body: { expectedVersion: inspection.version, responses: itemResponses(inspection).slice(0, 1) } }); inspection = inspectionFrom(firstSave, "mechanic first save");
  await clients.mechanic.dispose(); clients.mechanic = await createClient("mechanic"); await clients.mechanic.authenticate(config.accounts.mechanic);
  const resumed = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}`); inspection = inspectionFrom(resumed, "mechanic resume");
  const saved = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/responses`, { method: "PATCH", body: { expectedVersion: inspection.version, responses: itemResponses(inspection) } }); inspection = inspectionFrom(saved, "mechanic full save");
  record("mechanic-start-save-interrupt-resume", { inspectionId: inspection.id, savedVersion: inspection.version });
  const findings = inspection.findings || []; const repairFinding = findings.find((finding) => finding.disposition === "new_workorder"); const followUpFinding = findings.find((finding) => finding.disposition === "office_follow_up");
  if (!repairFinding?.id || !followUpFinding?.id) throw new Error("Two required QA findings were not persisted." );
  const workorder = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/workorders`, { method: "POST", body: { expectedVersion: inspection.version, findingIds: [repairFinding.id], idempotencyKey: `qa-inspection-workorder-${randomUUID()}`, concern: "QA inspection repair" }, expectedStatuses: [201] });
  const workorderId = workorder.body?.workorderId;
  if (workorderId) onWorkorderFixture(workorderId);
  inspection = inspectionFrom(workorder, "inspection workorder creation");
  const completed = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/actions/complete`, { method: "POST", body: { expectedVersion: inspection.version, finalNotes: "QA completed inspection." } }); inspection = inspectionFrom(completed, "inspection completion");
  record("mechanic-issue-workorder-complete", { inspectionId: inspection.id, workorderId: workorder.body?.workorder?.id || null });
  const officeDetail = await clients.office.request(`/api/inspections/${encodeURIComponent(inspection.id)}`); const officeInspection = inspectionFrom(officeDetail, "office summary link");
  if (!(officeInspection.workorderLinks || []).length) throw new Error("Completed inspection did not expose an authorized Summary workorder link.");
  record("summary-link-back", { inspectionId: inspection.id });
  const readonly = await clients.surveillance.request(`/api/inspections/${encodeURIComponent(inspection.id)}`);
  if ((readonly.body?.inspection?.workorderLinks || []).length || readonly.body?.inspection?.workorderId || readonly.body?.inspection?.workorderSerial) throw new Error("Read-only inspection projection leaked workorder identity.");
  record("read-only-slip", { inspectionId: inspection.id, status: readonly.status });
  const printIdempotencyKey = `qa-inspection-print-${randomUUID()}`;
  const archive = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/print-archives`, { method: "POST", body: { idempotencyKey: printIdempotencyKey }, expectedStatuses: [201] });
  if (!archive.body?.archive?.id) throw new Error("Inspection print archive was not created.");
  const archiveRead = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/print-archives/${encodeURIComponent(archive.body.archive.id)}`);
  if (!archiveRead.body?.html) throw new Error("Inspection print archive did not return printable HTML.");
  const pdfPath = archive.body.archive.downloadUrl || `/api/inspections/${encodeURIComponent(inspection.id)}/print-archives/${encodeURIComponent(archive.body.archive.id)}/pdf`;
  const pdf = await clients.mechanic.requestBytes(pdfPath, { expectedContentType: "application/pdf" });
  validateArchivedPdf(archive.body.archive, pdf.bytes);
  const replay = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(inspection.id)}/print-archives`, { method: "POST", body: { idempotencyKey: printIdempotencyKey }, expectedStatuses: [201] });
  if (replay.body?.archive?.id !== archive.body.archive.id) throw new Error("Inspection print archive idempotency replay created a different archive.");
  record("print", { archiveId: archive.body.archive.id, replayedArchiveId: replay.body.archive.id, documentByteSize: pdf.bytes.length });
  const followUp = (inspection.followUps || []).find((entry) => entry.findingId === followUpFinding.id && entry.status === "open");
  if (!followUp?.version) throw new Error("Completed Office follow-up was not opened.");
  const followedUp = await clients.office.request(`/api/inspections/${encodeURIComponent(inspection.id)}/follow-ups/${encodeURIComponent(followUpFinding.id)}/actions/no-workorder`, { method: "POST", body: { expectedVersion: followUp.version, idempotencyKey: `qa-inspection-follow-up-${randomUUID()}`, reason: "QA verified no repair workorder is required." } });
  inspection = inspectionFrom(followedUp, "Office follow-up resolution"); record("follow-up", { inspectionId: inspection.id });
  if (!workorderId) throw new Error("Inspection workorder creation did not return a workorder id.");
  const assignedRepair = await clients.office.request(`/api/office/workorders/${encodeURIComponent(workorderId)}/assignments`, { method: "POST", body: { mechanicUserIds: [actors.mechanic.id], reason: "QA assign inspection repair" } });
  if (!assignedRepair.body?.workorder?.mechanicIds?.includes(actors.mechanic.id)) throw new Error("Office did not assign the inspection repair to the QA mechanic.");
  const mechanicDone = await clients.mechanic.request(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/mark-done`, { method: "POST", body: { diagnosis: "QA inspection repair diagnosis.", workPerformed: "QA inspection repair completed.", confirmationName: actors.mechanic.name } });
  if (mechanicDone.body?.workorder?.status !== "mechanic_done") throw new Error("Inspection repair workorder did not reach mechanic_done.");
  const officeClosed = await clients.office.request(`/api/office/workorders/${encodeURIComponent(workorderId)}/close`, { method: "POST", body: { note: "QA inspection repair approved." } });
  if (officeClosed.body?.workorder?.status !== "closed") throw new Error("Inspection repair workorder did not reach Office closed.");
  const corrected = await clients.office.request(`/api/inspections/${encodeURIComponent(inspection.id)}/actions/correct`, { method: "POST", body: { expectedVersion: inspection.version, idempotencyKey: `qa-inspection-correction-${randomUUID()}`, reason: "QA correction evidence.", changes: { finalNotes: "QA corrected final notes." } }, expectedStatuses: [201] });
  const correction = inspectionFrom(corrected, "inspection correction");
  if (correction.finalNotes !== "QA corrected final notes.") throw new Error("Correction did not retain corrected final notes.");
  record("correction", { inspectionId: correction.id });
  const reinspected = await clients.office.request(`/api/inspections/${encodeURIComponent(correction.id)}/actions/reinspect`, { method: "POST", body: { expectedVersion: correction.version, idempotencyKey: `qa-inspection-reinspection-${randomUUID()}`, reason: "QA repair verified.", mechanicUserIds: [actors.mechanic.id], startImmediately: false }, expectedStatuses: [201] });
  const reinspection = inspectionFrom(reinspected, "inspection reinspection");
  validateReinspectionRecord(reinspection, correction.id);
  const reinspectionStarted = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(reinspection.id)}/actions/start`, { method: "POST", body: startPayload(reinspection) });
  let activeReinspection = inspectionFrom(reinspectionStarted, "reinspection start");
  const reinspectionSaved = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(activeReinspection.id)}/responses`, { method: "PATCH", body: { expectedVersion: activeReinspection.version, responses: itemResponses(activeReinspection).map((response) => ({ itemKey: response.itemKey, response: "pass" })) } });
  activeReinspection = inspectionFrom(reinspectionSaved, "reinspection save");
  const reinspectionCompleted = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(activeReinspection.id)}/actions/complete`, { method: "POST", body: { expectedVersion: activeReinspection.version, finalNotes: "QA reinspection completed." } });
  activeReinspection = inspectionFrom(reinspectionCompleted, "reinspection complete");
  if (activeReinspection.status !== "completed") throw new Error("Reinspection did not complete.");
  record("reinspection", { inspectionId: reinspection.id });
  const trailerCreated = await clients.office.request("/api/inspections", { method: "POST", body: inspectionCreatePayload({ location, assetId: config.fixtures.trailerAssetId, mechanicUserId: actors.mechanic.id, label: `${fixtureLabel} trailer` }), expectedStatuses: [201] });
  let trailerInspection = inspectionFrom(trailerCreated, "trailer request");
  const trailerStarted = await clients.mechanic.request(`/api/inspections/${encodeURIComponent(trailerInspection.id)}/actions/start`, { method: "POST", body: startPayload(trailerInspection) }); trailerInspection = inspectionFrom(trailerStarted, "trailer start");
  record("trailer-active-checklist", { inspectionId: trailerInspection.id, inspectionNumber: trailerInspection.inspectionNumber });
  return { inspectionId: inspection.id, inspectionNumber: inspection.inspectionNumber, correctionId: correction.id, reinspectionId: reinspection.id, reinspectionStatus: activeReinspection.status, trailerInspectionId: trailerInspection.id, trailerInspectionNumber: trailerInspection.inspectionNumber, workorderId, workorderNumber: (officeInspection.workorderLinks || [])[0]?.workorderSerial || "", capabilities: config.capabilities, trace };
}
