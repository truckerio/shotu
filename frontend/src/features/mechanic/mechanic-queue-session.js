const SESSION_KEY = "workorder-generator:mechanic-mixed-queue";

export function readMechanicQueueSession(storage = globalThis.sessionStorage) {
  try { const value = JSON.parse(storage?.getItem(SESSION_KEY) || "{}"); return { tab: value.tab || "myWork", search: value.search || "" }; } catch { return { tab: "myWork", search: "" }; }
}

export function writeMechanicQueueSession(value, storage = globalThis.sessionStorage) {
  try { storage?.setItem(SESSION_KEY, JSON.stringify({ tab: value.tab || "myWork", search: value.search || "" })); } catch { /* session storage is optional */ }
}
