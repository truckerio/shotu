const ACTIVE_LIFECYCLE_RANK = Object.freeze({
  in_progress: 0,
  accepted: 1,
  open: 2,
});

function normalizedLifecycle(job = {}) {
  if (["waiting_office", "parts_requested"].includes(job.status)) return "in_progress";
  return job.lifecycle || job.status || "open";
}

function timestamp(job = {}) {
  const value = Date.parse(job.startedAt || job.acceptedAt || job.createdAt || job.updatedAt || "");
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

export function compareMechanicJobs(left, right) {
  const lifecycleDifference = (ACTIVE_LIFECYCLE_RANK[normalizedLifecycle(left)] ?? 3)
    - (ACTIVE_LIFECYCLE_RANK[normalizedLifecycle(right)] ?? 3);
  if (lifecycleDifference) return lifecycleDifference;

  const timeDifference = timestamp(left) - timestamp(right);
  if (timeDifference) return timeDifference;

  return String(left.serial || left.id || "").localeCompare(String(right.serial || right.id || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function selectNextMechanicJob(jobs = []) {
  return [...jobs].sort(compareMechanicJobs)[0] || null;
}

export function mechanicJobActionKey(job) {
  return normalizedLifecycle(job) === "accepted" ? "startJob" : "continueJob";
}

export function mechanicJobActionLabel(job) {
  return mechanicJobActionKey(job) === "startJob" ? "Start job" : "Continue job";
}

export function buildMechanicHomeView(dashboard = {}) {
  const source = dashboard || {};
  const assigned = [...(source.myWork || [])].sort(compareMechanicJobs);
  const nextJob = assigned[0] || null;
  return {
    nextJob,
    assignedJobs: nextJob ? assigned.slice(1) : [],
    availableJobs: [...(source.openWork || [])],
    waitingJobs: [...(source.waiting || [])],
    historyJobs: [...(source.done || [])],
  };
}
