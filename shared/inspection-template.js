export const INSPECTION_FAMILY_KEY = "inspection";
export const INSPECTION_SCHEMA_VERSION = 1;
export const INSPECTION_RENDERER_VERSION = "inspection-slip-v1";

export const INSPECTION_BLOCK_TYPES = Object.freeze([
  "section", "instruction", "check", "notes", "unitIdentity", "inspectionMetadata",
  "findingsSummary", "relatedWorkorders", "physicalSignature", "pageBreak",
]);

const truckSections = [
  ["outside", "Outside", ["Lights and reflectors", "Tires and tire condition/pressure", "Wheels, rims, hubs, and lug nuts", "Mirrors, windshield, and wipers"]],
  ["mechanical", "Mechanical", ["Brakes and visible air or hydraulic leaks", "Steering", "Suspension", "Engine fluids and visible leaks", "Belts and hoses"]],
  ["safety", "Safety", ["Fifth wheel and coupling equipment", "Frame and body condition", "Horn and emergency equipment"]],
];

const trailerSections = [
  ["outside", "Outside", ["Lights and reflectors", "Tires", "Wheels, rims, hubs, and lug nuts", "Body, doors, roof, and floor"]],
  ["mechanical", "Mechanical", ["Brakes, air lines, and ABS indication", "Kingpin and coupling condition", "Electrical connection", "Suspension and axles", "Landing gear"]],
  ["safety", "Safety", ["Frame and crossmembers", "Mudflaps and rear-impact guard", "Cargo securement equipment"]],
];

function preset(key, label, assetType, sections) {
  return Object.freeze({
    familyKey: INSPECTION_FAMILY_KEY,
    presetKey: key,
    label,
    assetType,
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    rendererVersion: INSPECTION_RENDERER_VERSION,
    sections: Object.freeze(sections.map(([sectionKey, title, labels]) => Object.freeze({
      key: sectionKey,
      title,
      items: Object.freeze(labels.map((itemLabel, index) => Object.freeze({
        key: `${sectionKey}-${index + 1}`,
        label: itemLabel,
        required: true,
        allowNa: true,
        requireNaReason: false,
      }))),
    }))),
  });
}

export const WEEKLY_INSPECTION_PRESETS = Object.freeze({
  Truck: preset("weekly-truck", "Weekly Truck Inspection", "Truck", truckSections),
  Trailer: preset("weekly-trailer", "Weekly Trailer Inspection", "Trailer", trailerSections),
});

export const INSPECTION_TEMPLATE_FAMILY = Object.freeze({
  familyKey: INSPECTION_FAMILY_KEY,
  schemaVersion: INSPECTION_SCHEMA_VERSION,
  allowedBlockTypes: INSPECTION_BLOCK_TYPES,
  allowedBindings: Object.freeze(["inspection", "unit", "responses", "findings", "relatedWorkorders"]),
  rendererKey: INSPECTION_RENDERER_VERSION,
  supportedAssetTypes: Object.freeze(["Truck", "Trailer"]),
});

export function weeklyInspectionPreset(unitType) {
  return WEEKLY_INSPECTION_PRESETS[unitType] || null;
}

export function inspectionItemCount(definition) {
  return (definition?.sections || []).reduce((count, section) => count + (section.items?.length || 0), 0);
}

export function escapeInspectionHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function renderInspectionSlip(model) {
  const answers = new Map((model.responses || []).map((response) => [response.itemKey, response]));
  const findings = new Map((model.findings || []).map((finding) => [finding.responseId, finding]));
  const sections = (model.templateSnapshot?.sections || []).map((section) => `
    <section><h2>${escapeInspectionHtml(section.title)}</h2>
      ${(section.items || []).map((item) => {
        const answer = answers.get(item.key);
        const value = answer?.response || "";
        const finding = findings.get(answer?.id);
        const box = (candidate) => value === candidate ? "&#9746;" : "&#9744;";
        return `<div class="check"><span>${escapeInspectionHtml(item.label)}</span><span class="boxes">${box("pass")} Pass ${box("issue")} Issue ${box("na")} N/A</span>${finding ? `<small>${escapeInspectionHtml(finding.severity)} — ${escapeInspectionHtml(finding.note)}</small>` : ""}</div>`;
      }).join("")}
    </section>`).join("");
  const watermark = model.status === "completed" ? "" : '<div class="watermark">IN PROGRESS</div>';
  const revision = model.lineageKind === "correction" ? `<section class="revision"><strong>CORRECTION — REVISION ${escapeInspectionHtml(model.revisionNumber || 2)}</strong><span>Reason: ${escapeInspectionHtml(model.revisionReason)}</span><span>Corrects inspection: ${escapeInspectionHtml(model.predecessorInspectionNumber || model.predecessorInspectionId || "Recorded predecessor")}</span></section>` : model.lineageKind === "reinspection" ? `<section class="revision"><strong>REINSPECTION</strong><span>Reason: ${escapeInspectionHtml(model.revisionReason)}</span><span>Source inspection: ${escapeInspectionHtml(model.predecessorInspectionNumber || model.predecessorInspectionId || "Recorded predecessor")}</span></section>` : "";
  const linked = model.workordersLinked ? '<div class="linked"><strong>Workorder linked</strong></div>' : "";
  const startEvidence = model.startEvidence ? `<span><strong>Odometer:</strong> ${escapeInspectionHtml(model.startEvidence.odometerMiles)} mi</span>${model.startEvidence.engineHours == null ? "" : `<span><strong>Engine hours:</strong> ${escapeInspectionHtml(model.startEvidence.engineHours)}</span>`}<span><strong>Previous report:</strong> ${model.previousReportAvailable ? (model.startEvidence.previousReportReviewed ? "Reviewed" : "Not reviewed") : "None available"}</span>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeInspectionHtml(model.inspectionNumber || "Inspection")}</title><style>@page{size:letter;margin:.45in}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0}h1{font-size:20px;margin:0 0 4px}.revision{display:grid;gap:3px;border:2px solid #111;padding:7px;margin:8px 0}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 18px;border:1px solid #111;padding:8px;margin:10px 0}h2{font-size:13px;margin:10px 0 0;padding:5px 7px;background:#eee;border:1px solid #111}.check{display:grid;grid-template-columns:1fr auto;gap:3px 12px;padding:5px 7px;border:1px solid #bbb;border-top:0;break-inside:avoid}.check small{grid-column:1/-1}.boxes{white-space:nowrap}.notes,.signature,.linked{margin-top:12px;border:1px solid #111;padding:8px;min-height:42px}.linked{min-height:0}.signature{display:grid;grid-template-columns:1fr 160px;gap:24px;margin-top:18px}.watermark{position:fixed;transform:rotate(-30deg);font-size:70px;color:#ddd;top:40%;left:18%}</style></head><body>${watermark}<h1>${escapeInspectionHtml(model.templateLabel || "Weekly Inspection")}</h1>${revision}<div class="meta"><span><strong>Inspection:</strong> ${escapeInspectionHtml(model.inspectionNumber)}</span><span><strong>Unit:</strong> ${escapeInspectionHtml(model.unit?.unitNo)}</span><span><strong>VIN:</strong> ${escapeInspectionHtml(model.unit?.vin)}</span><span><strong>Plate:</strong> ${escapeInspectionHtml(model.unit?.licensePlate)}</span><span><strong>Result:</strong> ${escapeInspectionHtml(model.result || "")}</span><span><strong>Completed:</strong> ${escapeInspectionHtml(model.completedAt ? new Date(model.completedAt).toLocaleString("en-US") : "")}</span>${startEvidence}</div>${sections}<div class="notes"><strong>Notes</strong><p>${escapeInspectionHtml(model.finalNotes || "")}</p></div>${linked}<div class="signature"><span>Mechanic signature: ______________________________</span><span>Date: ______________</span></div></body></html>`;
}
