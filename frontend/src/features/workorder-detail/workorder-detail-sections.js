import { interfaceText, localizedUnitType } from "../../i18n/index.js";
import {
  orderWorkorderModules,
  resolveWorkorderModuleNavigation,
  resolveWorkorderModulePolicy,
  WORKORDER_MODULE_ACCESS,
  WORKORDER_MODULE_IDS,
  WORKORDER_SURFACES,
  workorderModuleDescriptors,
  workorderModuleLabel,
} from "../workorder-modules/workorder-module-registry.js";

const ATTENTION_STATUSES = new Set(["waiting_office", "parts_requested"]);
const DEFAULT_DETAIL_SECTION_SEQUENCE = Object.freeze([
  WORKORDER_MODULE_IDS.UNIT,
  WORKORDER_MODULE_IDS.CONCERN,
  WORKORDER_MODULE_IDS.SCHEDULE,
  WORKORDER_MODULE_IDS.PARTS,
  WORKORDER_MODULE_IDS.CHAT,
  WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR,
  WORKORDER_MODULE_IDS.COMPLETION,
  WORKORDER_MODULE_IDS.ASSIGNMENT,
  WORKORDER_MODULE_IDS.PHOTOS,
  WORKORDER_MODULE_IDS.LOCATION,
  WORKORDER_MODULE_IDS.ACTIVITY,
  WORKORDER_MODULE_IDS.PREVIEW,
]);
const CORE_DETAIL_SECTIONS = new Set(DEFAULT_DETAIL_SECTION_SEQUENCE.slice(0, 4));

function canonicalSectionProjection(sections) {
  const rank = new Map(DEFAULT_DETAIL_SECTION_SEQUENCE.map((id, index) => [id, index]));
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => (
      (rank.get(left.section.id) ?? Number.POSITIVE_INFINITY)
      - (rank.get(right.section.id) ?? Number.POSITIVE_INFINITY)
      || left.index - right.index
    ))
    .map(({ section }) => {
      const sequenceIndex = rank.get(section.id);
      return {
        ...section,
        alwaysPrimary: CORE_DETAIL_SECTIONS.has(section.id),
        overflow: !CORE_DETAIL_SECTIONS.has(section.id) || undefined,
        priority: Number.isFinite(sequenceIndex)
          ? DEFAULT_DETAIL_SECTION_SEQUENCE.length - sequenceIndex
          : 0,
      };
    });
}

export function defaultDetailSection(role, status, compact = false) {
  if (compact && ATTENTION_STATUSES.has(status)) return "chat";
  if (role === "mechanic") return "unit";
  if (status === "open" && ["admin", "office", "manager"].includes(role)) return "assignment";
  return "concern";
}

export function defaultSupportingView(role, status) {
  if (role === "mechanic" || ATTENTION_STATUSES.has(status)) return "chat";
  return "preview";
}

export function firstAllowedDetailSection(sections = [], fallback = "work") {
  return sections[0]?.id || fallback;
}

export function allowedDetailSection({ requestedSection, sections = [], fallback = "work" } = {}) {
  return sections.some((section) => section.id === requestedSection)
    ? requestedSection
    : firstAllowedDetailSection(sections, fallback);
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
  policyOverrides = [],
  pendingPartCount,
  role = isMechanicDetail ? "mechanic" : isOfficeDetail ? "office" : "surveillance",
  timelineCount,
  unitType,
  userId = "",
  locale = "en",
}) {
  if (!activeWorkorder) return [];
  const mechanicLabel = (key) => interfaceText(locale, key);
  const metadata = {
    [WORKORDER_MODULE_IDS.CONCERN]: { label: isMechanicDetail ? mechanicLabel("detail.concern") : undefined },
    [WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR]: {
      label: isMechanicDetail ? mechanicLabel("detail.work") : workorderModuleLabel(WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR),
    },
    [WORKORDER_MODULE_IDS.ODOO]: {
      attention: activeWorkorder?.workorder?.odooStatus === "missing_info"
        || (activeWorkorder?.workorder?.attentionReasons || []).includes("missing_info"),
    },
    [WORKORDER_MODULE_IDS.CHAT]: {
      label: isMechanicDetail ? mechanicLabel("detail.help") : "Chat",
      count: conversationCount || undefined,
      attention: ATTENTION_STATUSES.has(detailStatus),
    },
    [WORKORDER_MODULE_IDS.PARTS]: {
      label: isMechanicDetail ? mechanicLabel("detail.parts") : "Parts",
      count: pendingPartCount || filledPartCount || undefined,
      attention: pendingPartCount > 0,
    },
    [WORKORDER_MODULE_IDS.PHOTOS]: { label: isMechanicDetail ? mechanicLabel("detail.photos") : undefined },
    [WORKORDER_MODULE_IDS.COMPLETION]: {
      label: isMechanicDetail ? mechanicLabel("detail.completion") : undefined,
    },
    [WORKORDER_MODULE_IDS.UNIT]: {
      label: unitType
        ? (isMechanicDetail ? localizedUnitType(unitType, locale) : unitType)
        : (isMechanicDetail ? mechanicLabel("detail.unit") : workorderModuleLabel(WORKORDER_MODULE_IDS.UNIT)),
    },
    [WORKORDER_MODULE_IDS.ASSIGNMENT]: {
      label: isMechanicDetail ? mechanicLabel("detail.assignment") : undefined,
      count: assignedMechanicCount || undefined,
      attention: assignedMechanicCount === 0 || undefined,
    },
    [WORKORDER_MODULE_IDS.ACTIVITY]: {
      label: isMechanicDetail ? mechanicLabel("detail.activity") : workorderModuleLabel(WORKORDER_MODULE_IDS.ACTIVITY),
      count: timelineCount || undefined,
    },
    [WORKORDER_MODULE_IDS.LOCATION]: { label: isMechanicDetail ? mechanicLabel("detail.location") : undefined },
    [WORKORDER_MODULE_IDS.SCHEDULE]: { label: isMechanicDetail ? mechanicLabel("detail.schedule") : undefined },
    [WORKORDER_MODULE_IDS.PREVIEW]: { label: isMechanicDetail ? mechanicLabel("detail.preview") : undefined },
  };
  const sections = workorderModuleDescriptors(WORKORDER_SURFACES.DETAIL)
    .map((descriptor) => {
      const sectionMetadata = metadata[descriptor.id] || {};
      return {
        id: descriptor.routeBySurface.detail,
        ...sectionMetadata,
        label: sectionMetadata.label || descriptor.label,
      };
    });
  const navigationContext = {
    overrides: policyOverrides,
    role,
    surface: WORKORDER_SURFACES.DETAIL,
    userId,
  };
  const visibleSections = resolveWorkorderModuleNavigation(sections, navigationContext);
  const scanningPolicy = resolveWorkorderModulePolicy({
    ...navigationContext,
    moduleId: WORKORDER_MODULE_IDS.PARTS_SCANNING,
  });
  if (!scanningPolicy.canWrite || visibleSections.some(({ id }) => id === WORKORDER_MODULE_IDS.PARTS)) {
    return canonicalSectionProjection(visibleSections);
  }
  const hiddenPartsPolicy = resolveWorkorderModulePolicy({
    ...navigationContext,
    moduleId: WORKORDER_MODULE_IDS.PARTS,
  });
  const scanEnabledSections = orderWorkorderModules([...visibleSections, {
    id: WORKORDER_MODULE_IDS.PARTS,
    label: metadata[WORKORDER_MODULE_IDS.PARTS].label || workorderModuleLabel(WORKORDER_MODULE_IDS.PARTS),
    access: WORKORDER_MODULE_ACCESS.HIDDEN,
    modulePolicy: hiddenPartsPolicy,
    scanOnly: true,
  }], navigationContext);
  return canonicalSectionProjection(scanEnabledSections);
}

export function buildCompactPhoneDetailSections(sections, role, { locale = "en", policyOverrides = [], userId = "" } = {}) {
  const previewPolicy = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.PREVIEW,
    overrides: policyOverrides,
    role,
    surface: WORKORDER_SURFACES.DETAIL,
    userId,
  });
  const candidates = sections.some(({ id }) => id === WORKORDER_MODULE_IDS.PREVIEW)
    ? sections
    : previewPolicy.visible
      ? [...sections, {
        id: WORKORDER_MODULE_IDS.PREVIEW,
        label: role === "mechanic" ? interfaceText(locale, "detail.preview") : workorderModuleLabel(WORKORDER_MODULE_IDS.PREVIEW),
        access: previewPolicy.access,
        modulePolicy: previewPolicy,
      }]
      : sections;
  const normalizedRole = role === "manager" ? "office" : role;
  const compactModules = candidates
    .filter((section) => section.modulePolicy?.descriptor?.compactPlacement?.[normalizedRole]
      || resolveWorkorderModulePolicy({
        moduleId: section.id,
        overrides: policyOverrides,
        role,
        surface: WORKORDER_SURFACES.DETAIL,
        userId,
      }).descriptor?.compactPlacement?.[normalizedRole]);

  const orderedModules = orderWorkorderModules(compactModules, {
    compact: true,
    role,
    surface: WORKORDER_SURFACES.DETAIL,
  }).filter((section) => {
    const placement = section.modulePolicy?.descriptor?.compactPlacement?.[normalizedRole];
    if (placement) return true;
    const policy = resolveWorkorderModulePolicy({
      moduleId: section.id,
      overrides: policyOverrides,
      role,
      surface: WORKORDER_SURFACES.DETAIL,
      userId,
    });
    return Boolean(policy.descriptor?.compactPlacement?.[normalizedRole]);
  });
  return canonicalSectionProjection(orderedModules);
}

export function coerceAllowedDetailSection(requestedSection, sections = [], fallback = "work") {
  if (sections.some((section) => section.id === requestedSection)) return requestedSection;
  return firstAllowedDetailSection(sections, fallback);
}

export function buildSurveillanceWorkorderDetailSections({
  activityCount,
  canProcessOdoo,
  missingCount,
  unitType,
  usedPartCount,
  policyOverrides = [],
  role = "surveillance",
  userId = "",
}) {
  return buildWorkorderDetailSections({
    activeWorkorder: {
      workorder: {
        id: "surveillance-detail",
        odooStatus: missingCount > 0 ? "missing_info" : "",
        status: canProcessOdoo ? "closed" : "open",
      },
    },
    conversationCount: 0,
    detailStatus: canProcessOdoo ? "closed" : "open",
    filledPartCount: usedPartCount,
    isMechanicDetail: false,
    isOfficeDetail: false,
    pendingPartCount: 0,
    policyOverrides,
    role,
    timelineCount: activityCount,
    unitType,
    userId,
  });
}

export function workorderNeedsChatAttention(status) {
  return ATTENTION_STATUSES.has(status);
}

export function workorderPreviewState(activeWorkorder, form, error = "") {
  if (error) return { status: "error", message: error };
  if (!activeWorkorder) return { status: "loading", message: "Loading workorder preview…" };
  if (!form) return { status: "empty", message: "Workorder preview is unavailable." };
  return { status: "ready", message: "" };
}
