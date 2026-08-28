import { useMemo } from "react";

import {
  assignedMechanicIdsFromDetail,
  conversationMessagesFromDetail,
  pendingPartRequestCount,
} from "./workorder-detail-view-model.js";
import { getVehicleLocation } from "../../components/workorders/AssetLocationCard.jsx";
import { buildWorkorderDetailSections } from "../../features/workorder-detail/workorder-detail-sections.js";
import { formatLifecycleLabel } from "../../lib/workorder-presentation.js";
import { timelineEventCount } from "../../components/workorders/workorder-timeline-model.js";
import { interfaceText } from "../../i18n/index.js";

const ATTENTION_STATUS_LABELS = {
  waiting_office: "Needs office",
  parts_requested: "Parts requested",
};

export function useWorkorderDetailViewModel({
  activeWorkorder,
  detailStatus,
  form,
  interfaceLocale,
  isCompact,
  isMechanicDetail,
  isOfficeDetail,
  officeAssignment,
  policyOverrides = null,
  previewPanelOpen,
  role,
  selectedOfficeLocation,
  selectedVehicle,
  userId = "",
}) {
  const assignedMechanicIds = assignedMechanicIdsFromDetail(activeWorkorder);
  const conversationMessages = useMemo(
    () => conversationMessagesFromDetail(activeWorkorder),
    [activeWorkorder],
  );
  const filledPartCount = form.parts.filter((part) => part.partNo || part.qty || part.repairOrder).length;
  const mechanicAsset = activeWorkorder?.workorder?.asset || {};
  const t = (key) => interfaceText(interfaceLocale, key);
  const mechanicUnitType = form.unitType || mechanicAsset.unitType || t("location.vehicle");
  const mechanicVehicleLabel = [mechanicAsset.year, mechanicAsset.make, mechanicAsset.model]
    .filter(Boolean)
    .join(" ") || form.model || t("detail.notListed");
  const mechanicMapVehicle = selectedVehicle || mechanicAsset;
  const mechanicMapLocation = getVehicleLocation(mechanicMapVehicle);
  const pendingPartCount = pendingPartRequestCount(activeWorkorder);
  const visibleTimeline = useMemo(
    () => (activeWorkorder?.timeline || []).filter((event) => event.type !== "access"),
    [activeWorkorder?.timeline],
  );
  const detailSections = useMemo(() => buildWorkorderDetailSections({
    activeWorkorder,
    assignedMechanicCount: assignedMechanicIds.length,
    conversationCount: conversationMessages.length,
    detailStatus,
    filledPartCount,
    isCompact,
    isMechanicDetail,
    isOfficeDetail,
    pendingPartCount,
    policyOverrides,
    role: role || (isMechanicDetail ? "mechanic" : isOfficeDetail ? "office" : "surveillance"),
    timelineCount: timelineEventCount(visibleTimeline),
    unitType: form.unitType,
    userId,
    locale: interfaceLocale,
  }), [
    activeWorkorder,
    assignedMechanicIds.length,
    conversationMessages.length,
    detailStatus,
    filledPartCount,
    form.unitType,
    interfaceLocale,
    isCompact,
    isMechanicDetail,
    isOfficeDetail,
    pendingPartCount,
    policyOverrides,
    role,
    userId,
    visibleTimeline.length,
  ]);
  const assignedMechanicKey = [...assignedMechanicIds].sort().join(",");
  const officeAssignmentKey = [...officeAssignment.mechanicUserIds].sort().join(",");
  const mechanicStatusKey = ({
    accepted: "accepted",
    cancelled: "cancelled",
    closed: "closed",
    in_progress: "inProgress",
    mechanic_done: "workCompleted",
    odoo_entered: "odooEntered",
    open: "open",
    parts_requested: "partsRequested",
    waiting_office: "waitingOffice",
  })[detailStatus] || "open";

  return {
    assignedMechanicIds,
    conversationMessages,
    currentStatusLabel: isMechanicDetail
      ? (detailStatus === "waiting_office" ? t("queue.needsOffice")
        : t(`timeline.status.${mechanicStatusKey}`))
      : ATTENTION_STATUS_LABELS[detailStatus] || formatLifecycleLabel(detailStatus, { fallback: "Open" }),
    detailLocationName: activeWorkorder?.workorder?.location?.name
      || selectedOfficeLocation?.location?.name
      || "",
    detailMechanicNames: activeWorkorder?.workorder?.mechanics
      ?.map((mechanic) => mechanic.name)
      .filter(Boolean)
      .join(", ")
      || activeWorkorder?.workorder?.mechanic?.name
      || form.mechanicName,
    detailSections,
    filledPartCount,
    mechanicAsset,
    mechanicMapLocation,
    mechanicMapVehicle,
    mechanicUnitType,
    mechanicVehicleLabel,
    officeAssignmentChanged: officeAssignmentKey !== assignedMechanicKey,
    pendingPartCount,
    policyOverrides,
    showEmbeddedPreview: previewPanelOpen && (!activeWorkorder || !isCompact),
    visibleTimeline,
  };
}
