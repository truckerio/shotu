function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function canonicalTimeInput(value) {
  const date = validDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatHandoffTimestamp(value, { locale, notRecorded = "Not recorded" } = {}) {
  const date = validDate(value);
  if (!date) return notRecorded;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function earliestAssignmentAt(workorder) {
  const assignmentTimes = (workorder?.mechanics || [])
    .map((mechanic) => validDate(mechanic.assignedAt))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());
  return assignmentTimes[0]?.toISOString() || workorder?.acceptedAt || null;
}

export function canonicalPreviewTimes(workorder) {
  return {
    startTime: canonicalTimeInput(workorder?.startedAt),
    endTime: canonicalTimeInput(workorder?.mechanicDoneAt),
  };
}

export function canonicalApprovalName(workorder) {
  return workorder?.approvedBy?.name || workorder?.approvedByName || "";
}

export function workorderHandoffFacts(workorder, { locale, localeText } = {}) {
  const text = (key, english) => localeText ? localeText(key) : english;
  const timeOptions = { locale, notRecorded: text("detail.notRecorded", "Not recorded") };
  return [
    { label: text("completion.assigned", "Assigned"), value: formatHandoffTimestamp(earliestAssignmentAt(workorder), timeOptions) },
    { label: text("completion.started", "Started"), value: formatHandoffTimestamp(workorder?.startedAt, timeOptions) },
    { label: text("completion.workDone", "Work done"), value: formatHandoffTimestamp(workorder?.mechanicDoneAt, timeOptions) },
    {
      label: text("completion.managerApproved", "Manager approved"),
      value: formatHandoffTimestamp(workorder?.closedAt, timeOptions),
      detail: canonicalApprovalName(workorder),
    },
  ];
}

export const RETURN_CATEGORIES = [
  { value: "diagnosis", label: "Diagnosis" },
  { value: "work_performed", label: "Work performed" },
  { value: "parts", label: "Parts" },
  { value: "photos", label: "Photos" },
  { value: "other", label: "Other" },
];
