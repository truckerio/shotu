const PREFIX = "workorder-generator.inspections.";
const SESSION_VERSION = 2;

export function inspectionSessionKey(projection = "office") { return `${PREFIX}${projection}`; }

export function readInspectionSession(projection) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(inspectionSessionKey(projection)) || "{}");
    const current = parsed.version === SESSION_VERSION;
    return { search: current && typeof parsed.search === "string" ? parsed.search : "", status: current && typeof parsed.status === "string" ? parsed.status : "", activeId: current && typeof parsed.activeId === "string" ? parsed.activeId : "", scrollY: current && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0 };
  } catch { return { search: "", status: "", activeId: "", scrollY: 0 }; }
}

export function writeInspectionSession(projection, value = {}) {
  try { window.sessionStorage.setItem(inspectionSessionKey(projection), JSON.stringify({ version:SESSION_VERSION, search: value.search || "", status: value.status || "", activeId: value.activeId || "", scrollY: Number(value.scrollY) || 0 })); } catch { /* Private browsing storage may be unavailable. */ }
}
