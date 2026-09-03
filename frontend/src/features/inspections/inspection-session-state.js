const PREFIX = "workorder-generator.inspections.";

export function inspectionSessionKey(projection = "office") { return `${PREFIX}${projection}`; }

export function readInspectionSession(projection) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(inspectionSessionKey(projection)) || "{}");
    return { search: typeof parsed.search === "string" ? parsed.search : "", status: typeof parsed.status === "string" ? parsed.status : "", activeId: typeof parsed.activeId === "string" ? parsed.activeId : "", scrollY: Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0 };
  } catch { return { search: "", status: "", activeId: "", scrollY: 0 }; }
}

export function writeInspectionSession(projection, value = {}) {
  try { window.sessionStorage.setItem(inspectionSessionKey(projection), JSON.stringify({ search: value.search || "", status: value.status || "", activeId: value.activeId || "", scrollY: Number(value.scrollY) || 0 })); } catch { /* Private browsing storage may be unavailable. */ }
}
