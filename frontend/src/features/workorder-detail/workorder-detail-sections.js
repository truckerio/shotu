const ATTENTION_STATUSES = new Set(["waiting_office", "parts_requested"]);

export function defaultDetailSection(role, status, compact = false) {
  if (compact && ATTENTION_STATUSES.has(status)) return "chat";
  if (role === "mechanic") return "work";
  if (status === "open") return "team";
  return "work";
}

export function defaultSupportingView(role, status) {
  if (role === "mechanic" || ATTENTION_STATUSES.has(status)) return "chat";
  return "preview";
}

export function workorderDetailSectionMode() {
  return "panel";
}

export function buildWorkorderDetailSections({
  activeWorkorder,
  assignedMechanicCount,
  conversationCount,
  detailStatus,
  filledPartCount,
  isCompact,
  isMechanicDetail,
  isOfficeDetail,
  pendingPartCount,
  timelineCount,
  unitType,
}) {
  if (!activeWorkorder) return [];
  const sections = [{ id: "work", label: isMechanicDetail ? "Work" : "Review" }];
  if (isCompact) {
    sections.push({
      id: "chat",
      label: "Chat",
      count: conversationCount || undefined,
      attention: ATTENTION_STATUSES.has(detailStatus),
    });
  }
  sections.push(
    {
      id: "parts",
      label: "Parts",
      count: pendingPartCount || filledPartCount || undefined,
      attention: pendingPartCount > 0,
    },
    { id: "unit", label: unitType || "Unit" },
  );
  if (isOfficeDetail) {
    sections.push({
      id: "team",
      label: "Team",
      count: assignedMechanicCount || undefined,
      attention: !assignedMechanicCount,
    });
  }
  sections.push({ id: "activity", label: "Activity", count: timelineCount || undefined });
  return sections;
}

export function workorderNeedsChatAttention(status) {
  return ATTENTION_STATUSES.has(status);
}
