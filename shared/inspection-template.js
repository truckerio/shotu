import { renderAnnualInspectionReport } from "./inspection-annual-report.js";

export const INSPECTION_FAMILY_KEY = "inspection";
export const INSPECTION_SCHEMA_VERSION = 1;
export const INSPECTION_RENDERER_VERSION = "inspection-slip-v1";
export const INSPECTION_ANNUAL_RENDERER_VERSION = "inspection-annual-v1";
export const INSPECTION_PRINT_LAYOUTS = Object.freeze([
  Object.freeze({ key: "standard", label: "Standard slip" }),
  Object.freeze({ key: "annual_report", label: "Annual report" }),
]);

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

function preset(key, label, assetType, sections, inspectionType = "weekly") {
  return Object.freeze({
    familyKey: INSPECTION_FAMILY_KEY,
    presetKey: key,
    inspectionType,
    label,
    assetType,
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    rendererVersion: inspectionType === "annual" ? INSPECTION_ANNUAL_RENDERER_VERSION : INSPECTION_RENDERER_VERSION,
    ...(inspectionType === "annual" ? { printLayout: "annual_report" } : {}),
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

export const INSPECTION_TYPES = Object.freeze([
  { key: "weekly", label: "Weekly" },
  { key: "annual", label: "Annual" },
  { key: "pre_trip", label: "Pre-trip" },
  { key: "post_trip", label: "Post-trip" },
  { key: "custom", label: "Custom" },
].map(Object.freeze));

// The shop's paper report has 15 sections. Keep every check for both asset
// types; inspectors use N/A for equipment that is not fitted to the unit.
const annualSections = () => [
  ["brakes", "Brake system", ["Service brakes", "Parking brake system", "Brake drums or rotors", "Brake hose", "Brake tubing", "Low pressure warning device", "Tractor protection valve", "Air compressor", "Electric brakes", "Hydraulic brakes", "Vacuum systems", "Antilock brake system", "Automatic brake adjusters"]],
  ["coupling", "Coupling devices", ["Fifth wheels", "Pintle hooks", "Drawbar/towbar eye", "Drawbar/towbar tongue", "Safety devices", "Saddle-mounts"]],
  ["exhaust", "Exhaust system", ["No exhaust leaks forward of or directly below the driver/sleeper compartment", "Exhaust does not leak or discharge in violation of the applicable standard", "Exhaust cannot burn, char, or damage wiring, fuel supply, or other combustible vehicle parts"]],
  ["fuel", "Fuel system", ["No visible fuel leaks", "Fuel tank filler cap present", "Fuel tank securely attached"]],
  ["lighting", "Lighting devices", ["All lighting devices and reflectors required by Part 393 are operable"]],
  ["loading", "Safe loading", ["Vehicle, load, dunnage, spare tire, and other parts secured against falling onto the roadway", "Cargo protected against shifting", "Container securement devices on intermodal equipment"]],
  ["steering", "Steering mechanism", ["Steering wheel free play", "Steering column", "Front axle beam and all steering components other than the steering column", "Steering gear box", "Pitman arm", "Power steering", "Ball and socket joints", "Tie rods and drag links", "Nuts", "Steering system"]],
  ["suspension", "Suspension", ["U-bolts, spring hangers, and axle-positioning parts not cracked, broken, loose, or missing; axle remains in its normal position", "Spring assembly", "Torque, radius, or tracking components"]],
  ["frame", "Frame", ["Frame members", "Tire and wheel clearance", "Adjustable axle assemblies (sliding subframes)"]],
  ["tires", "Tires", ["Tires on any steering axle of a power unit", "All other tires", "Speed-restricted tires installed only as specifically designated by the motor carrier"]],
  ["wheels", "Wheels and rims", ["Lock or side ring", "Wheels and rims", "Fasteners", "Welds"]],
  ["glazing", "Windshield glazing", ["Windshield glazing meets crack, discoloration, and vision-obstruction requirements and exceptions (49 CFR 393.60)"]],
  ["wipers", "Windshield wipers", ["Windshield wipers operate effectively without missing or damaged parts"]],
  ["seats", "Motorcoach seats", ["Passenger seats securely fastened to the vehicle structure"]],
  ["other", "Other", ["No other condition prevents safe operation of the vehicle"]],
];

const tripSections = (assetType, postTrip) => [
  ["safety", postTrip ? "End-of-day condition" : "Before driving", ["Service brakes and trailer brake connections", "Parking brake", "Lights and reflectors", "Tires, wheels, and rims", "Coupling devices and connections", ...(assetType === "Truck" ? ["Steering mechanism", "Horn", "Windshield wipers and mirrors", "Emergency equipment"] : ["Frame, body, and rear-impact guard", "Landing gear and cargo securement"]) ]],
  ["review", "Defects and follow-up", [postTrip ? "Damage, leaks, or defects discovered during operation" : "Previous defect report and repair certification reviewed"]],
];

export const INSPECTION_PRESETS = Object.freeze([
  ...Object.values(WEEKLY_INSPECTION_PRESETS),
  ...["Truck", "Trailer"].flatMap((assetType) => [
    preset(`annual-${assetType.toLowerCase()}`, `Annual ${assetType} Inspection`, assetType, annualSections(assetType), "annual"),
    preset(`pre-trip-${assetType.toLowerCase()}`, `Pre-trip ${assetType} Inspection`, assetType, tripSections(assetType, false), "pre_trip"),
    preset(`post-trip-${assetType.toLowerCase()}`, `Post-trip ${assetType} Inspection`, assetType, tripSections(assetType, true), "post_trip"),
    preset("custom", `Custom ${assetType} Inspection`, assetType, [["checks", "Checks", ["General condition"]]], "custom"),
  ]),
]);

export function inspectionPreset(unitType, inspectionType = "weekly") {
  return INSPECTION_PRESETS.find((entry) => entry.assetType === unitType && entry.inspectionType === inspectionType) || null;
}

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
  if (model.templateSnapshot?.printLayout === "annual_report" && model.templateSnapshot?.rendererVersion === INSPECTION_ANNUAL_RENDERER_VERSION) {
    return renderAnnualInspectionReport(model);
  }
  const answers = new Map((model.responses || []).map((response) => [response.itemKey, response]));
  const findings = new Map((model.findings || []).map((finding) => [finding.responseId, finding]));
  const sections = (model.templateSnapshot?.sections || []).map((section) => `
    <tbody><tr class="section"><th colspan="3">${escapeInspectionHtml(section.title)}</th></tr>
      ${(section.items || []).map((item) => {
        const answer = answers.get(item.key);
        const value = answer?.response || "";
        const finding = findings.get(answer?.id);
        const outcome = { pass: "Pass", issue: "Issue", na: "N/A" }[value] || "Pending";
        const policy = finding?.disposition === "defer" ? finding.deferral : null;
        const triggers = policy ? [policy.nextVisit ? "Next shop visit" : "", policy.dueDate ? `By ${policy.dueDate}` : "", policy.dueMiles == null ? "" : `At ${policy.dueMiles} mi`].filter(Boolean) : [];
        const deferredDetail = policy ? `Deferred: ${policy.reason}. Review: ${triggers.join("; ")}${triggers.length > 1 ? "; whichever comes first" : ""}${policy.dueMiles == null ? "" : `. Early notice: ${policy.earlyMiles} mi`}` : "";
        const detail = finding ? [finding.severity, finding.note, deferredDetail].filter(Boolean).join(" - ") : (value === "na" ? answer?.naReason : "");
        return `<tr class="check"><td>${escapeInspectionHtml(item.label)}</td><td class="outcome">${outcome}</td><td class="detail">${escapeInspectionHtml(detail)}</td></tr>`;
      }).join("")}
    </tbody>`).join("");
  const watermark = model.status === "completed" ? "" : '<div class="watermark">IN PROGRESS</div>';
  const revision = model.lineageKind === "correction" ? `<section class="revision"><strong>CORRECTION — REVISION ${escapeInspectionHtml(model.revisionNumber || 2)}</strong><span>Reason: ${escapeInspectionHtml(model.revisionReason)}</span><span>Corrects inspection: ${escapeInspectionHtml(model.predecessorInspectionNumber || model.predecessorInspectionId || "Recorded predecessor")}</span></section>` : model.lineageKind === "reinspection" ? `<section class="revision"><strong>REINSPECTION</strong><span>Reason: ${escapeInspectionHtml(model.revisionReason)}</span><span>Source inspection: ${escapeInspectionHtml(model.predecessorInspectionNumber || model.predecessorInspectionId || "Recorded predecessor")}</span></section>` : "";
  const linked = model.workordersLinked ? '<div class="linked"><strong>Workorder linked</strong></div>' : "";
  const startEvidence = model.startEvidence ? `<span><strong>Odometer:</strong> ${escapeInspectionHtml(model.startEvidence.odometerMiles)} mi</span>${model.startEvidence.engineHours == null ? "" : `<span><strong>Engine hours:</strong> ${escapeInspectionHtml(model.startEvidence.engineHours)}</span>`}<span><strong>Previous report:</strong> ${model.previousReportAvailable ? (model.startEvidence.previousReportReviewed ? "Reviewed" : "Not reviewed") : "None available"}</span>` : "";
  const notes = model.finalNotes?.trim() ? `<div class="notes"><strong>Notes:</strong> ${escapeInspectionHtml(model.finalNotes)}</div>` : "";
  const result = { passed: "Passed", issues_found: "Issues found", out_of_service: "Out of service" }[model.result] || String(model.result || "Pending").replaceAll("_", " ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeInspectionHtml(model.inspectionNumber || "Inspection")}</title><style>@page{size:letter;margin:.45in}*{box-sizing:border-box}body{font:11px/1.4 Arial,sans-serif;color:#20242b;margin:0}h1{font-size:16px;font-weight:600;margin:0 0 6px}.revision{display:grid;gap:2px;border:1px solid #9ca3af;padding:6px;margin:8px 0;break-inside:avoid}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:3px 18px;border-bottom:1px solid #9ca3af;padding:0 0 8px;margin:0 0 10px}strong{font-weight:600}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th,td{padding:4px 6px;text-align:left;border-bottom:1px solid #d1d5db;vertical-align:top;overflow-wrap:anywhere}thead th{font-weight:600;font-size:10px;color:#525963}.section th{background:#f3f4f6;font-weight:600;padding-top:5px}.check{break-inside:avoid}.outcome{white-space:nowrap}.detail,.notes{white-space:pre-wrap}.notes,.linked{margin-top:8px;overflow-wrap:anywhere}.signature{display:grid;grid-template-columns:1fr 160px;gap:24px;margin-top:22px;break-inside:avoid}.watermark{position:fixed;transform:rotate(-30deg);font-size:70px;color:#ddd;top:40%;left:18%;z-index:-1}</style></head><body>${watermark}<h1>${escapeInspectionHtml(model.templateLabel || "Weekly Inspection")}</h1>${revision}<div class="meta"><span><strong>Inspection:</strong> ${escapeInspectionHtml(model.inspectionNumber)}</span><span><strong>Unit:</strong> ${escapeInspectionHtml(model.unit?.unitNo)}</span>${model.unit?.vin ? `<span><strong>VIN:</strong> ${escapeInspectionHtml(model.unit.vin)}</span>` : ""}${model.unit?.licensePlate ? `<span><strong>Plate:</strong> ${escapeInspectionHtml(model.unit.licensePlate)}</span>` : ""}<span><strong>Result:</strong> ${escapeInspectionHtml(result)}</span><span><strong>Completed:</strong> ${escapeInspectionHtml(model.completedAt ? new Date(model.completedAt).toLocaleString("en-US") : "Pending")}</span>${startEvidence}</div><table><colgroup><col style="width:48%"><col style="width:12%"><col style="width:40%"></colgroup><thead><tr><th>Check</th><th>Result</th><th>Details</th></tr></thead>${sections}</table>${notes}${linked}<div class="signature"><span>Mechanic signature: ______________________________</span><span>Date: ______________</span></div></body></html>`;
}
