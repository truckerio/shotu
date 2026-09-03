import { INSPECTION_STATUS } from "./inspection.constants.js";

const transitions = Object.freeze({
  [INSPECTION_STATUS.REQUESTED]: new Set([INSPECTION_STATUS.ASSIGNED, INSPECTION_STATUS.CANCELLED]),
  [INSPECTION_STATUS.ASSIGNED]: new Set([INSPECTION_STATUS.IN_PROGRESS, INSPECTION_STATUS.CANCELLED]),
  [INSPECTION_STATUS.IN_PROGRESS]: new Set([INSPECTION_STATUS.COMPLETED, INSPECTION_STATUS.CANCELLED]),
  [INSPECTION_STATUS.COMPLETED]: new Set(),
  [INSPECTION_STATUS.CANCELLED]: new Set(),
});

export function canTransitionInspection(fromStatus, toStatus) { return transitions[fromStatus]?.has(toStatus) || false; }
export function deriveInspectionResult(findings) {
  if ((findings || []).some((finding) => finding.severity === "out_of_service")) return "out_of_service";
  return (findings || []).length ? "issues_found" : "passed";
}
