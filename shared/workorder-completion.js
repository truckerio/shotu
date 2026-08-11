const MAX_WORK_PERFORMED_LENGTH = 5000;

function repairOrderLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function repairOrderCompletionText(parts = [], maxLength = MAX_WORK_PERFORMED_LENGTH) {
  const lines = [];
  const seen = new Set();

  for (const part of Array.isArray(parts) ? parts : []) {
    const repairOrder = repairOrderLine(part?.repairOrder);
    const key = repairOrder.toLocaleLowerCase();
    if (!repairOrder || seen.has(key)) continue;
    seen.add(key);
    lines.push(repairOrder);
  }

  return lines.join("\n").slice(0, maxLength).trim();
}

export function resolveWorkPerformed(workorder = {}) {
  const explicit = String(workorder.workPerformed || "").trim();
  if (explicit) return explicit.slice(0, MAX_WORK_PERFORMED_LENGTH);
  return repairOrderCompletionText(workorder.parts);
}
