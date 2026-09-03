export const INSPECTION_RESPONSES = Object.freeze(["pass", "issue", "na"]);
export const INSPECTION_SEVERITIES = Object.freeze(["attention", "repair_required", "out_of_service"]);

const WEEKLY_TRUCK_SECTIONS = Object.freeze([
  ["outside", "Outside", ["Lights and reflectors", "Tires and tire condition/pressure", "Wheels, rims, hubs, and lug nuts", "Mirrors, windshield, and wipers"]],
  ["mechanical", "Mechanical", ["Brakes and visible air or hydraulic leaks", "Steering", "Suspension", "Engine fluids and visible leaks", "Belts and hoses"]],
  ["safety", "Safety", ["Fifth wheel and coupling equipment", "Frame and body condition", "Horn and emergency equipment"]],
]);

const WEEKLY_TRAILER_SECTIONS = Object.freeze([
  ["outside", "Outside", ["Lights and reflectors", "Tires", "Wheels, rims, hubs, and lug nuts", "Body, doors, roof, and floor"]],
  ["mechanical", "Mechanical", ["Brakes, air lines, and ABS indication", "Kingpin and coupling condition", "Electrical connection", "Suspension and axles", "Landing gear"]],
  ["safety", "Safety", ["Frame and crossmembers", "Mudflaps and rear-impact guard", "Cargo securement equipment"]],
]);

export function weeklyInspectionTemplate(unitType = "truck") {
  const normalizedType = String(unitType).toLowerCase() === "trailer" ? "trailer" : "truck";
  const sections = normalizedType === "trailer" ? WEEKLY_TRAILER_SECTIONS : WEEKLY_TRUCK_SECTIONS;
  return {
    key: `weekly_${normalizedType}`,
    label: `Weekly ${normalizedType === "truck" ? "Truck" : "Trailer"} Inspection`,
    sections: sections.map(([key, label, labels]) => ({
      key,
      label,
      items: labels.map((itemLabel, index) => ({
        key: `${key}_${index + 1}`,
        label: itemLabel,
        naAllowed: true,
        naReasonRequired: false,
      })),
    })),
  };
}

export function inspectionProgress(template, responses = {}) {
  const items = (template?.sections || []).flatMap((section) => section.items || []);
  const answered = items.filter((item) => INSPECTION_RESPONSES.includes(responses[item.key]?.response)).length;
  const issues = items.filter((item) => responses[item.key]?.response === "issue").length;
  return { total: items.length, answered, issues, complete: items.length > 0 && answered === items.length };
}

export function inspectionResult(template, responses = {}) {
  const progress = inspectionProgress(template, responses);
  if (!progress.complete) return "";
  const severities = Object.values(responses).filter((response) => response?.response === "issue").map((response) => response.severity);
  if (severities.includes("out_of_service")) return "out_of_service";
  return progress.issues ? "issues_found" : "passed";
}

export function responseIsComplete(item, value = {}) {
  if (!INSPECTION_RESPONSES.includes(value.response)) return false;
  if (value.response === "issue") {
    if (!(value.severity && value.note?.trim() && value.disposition)) return false;
    if (value.disposition === "no_workorder") return Boolean(value.noWorkorderReason?.trim());
  }
  if (value.response === "na" && item.naReasonRequired) return Boolean(value.naReason?.trim());
  return true;
}

export function inspectionResponseShouldSave(item, value = {}, commit = true) {
  return Boolean(commit && responseIsComplete(item, value));
}

export function inspectionCanComplete(template, responses = {}) {
  return (template?.sections || []).flatMap((section) => section.items || []).every((item) => responseIsComplete(item, responses[item.key]));
}

export function inspectionMatchesSearch(inspection, search = "") {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [inspection.number, inspection.unitNo, inspection.vin, inspection.plate, inspection.locationName, inspection.mechanicName, inspection.status, inspection.result]
    .filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
}

export function inspectionActionForRole(inspection, projection = "office") {
  if (projection === "read_only") return inspection.status === "completed" ? "View slip" : "View status";
  if (projection === "mechanic") {
    if (inspection.status === "in_progress") return "Continue";
    if (inspection.status === "assigned") return "Start";
    if (inspection.status === "completed") return "View slip";
    return "View status";
  }
  if (inspection.status === "requested") return "Assign";
  if (inspection.status === "assigned") return "Review";
  if (inspection.status === "completed") return "View slip";
  return "Review";
}

export function inspectionStatusLabel(status) {
  return ({ requested: "Requested", assigned: "Assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" })[status] || "Not completed";
}

export function inspectionResultLabel(result) {
  return ({ passed: "Passed", issues_found: "Issues found", out_of_service: "Out of service" })[result] || "Not completed";
}
