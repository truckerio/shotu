import { DEFAULT_UOM_CODE, normalizeUomCode } from "../../../../../shared/units-of-measure.js";

export const SOURCE_LABELS = {
  inventory: "Inventory",
  purchase: "Purchase",
  transfer: "Transfer",
  customer_supplied: "Customer supplied",
  mechanic_supplied: "Mechanic supplied",
  unknown: "Decide later",
};

export const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

export const ALLOCATION_STATUS_LABELS = {
  proposed: "Planned",
  reserved: "Reserved",
  issued: "Issued",
  ordered: "Ordered",
  received: "Received",
  transferred: "Transferred",
  installed: "Installed",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const APPROVAL_LABELS = {
  submitted: "Waiting for office",
  needs_info: "Needs information",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const FITMENT_OPTIONS = [
  { value: "unknown", label: "Not verified" },
  { value: "possible", label: "Possible" },
  { value: "confirmed", label: "Confirmed" },
  { value: "conflict", label: "Conflict" },
];

export function createEmptyPartDraft() {
  return {
    query: "",
    partNumber: "",
    manufacturer: "",
    description: "",
    category: "",
    quantity: "",
    uomCode: DEFAULT_UOM_CODE,
    repairOrder: "",
    fitmentStatus: "unknown",
    fitmentNotes: "",
  };
}

export function vehicleInput(detail) {
  const asset = detail.workorder.asset || {};
  return {
    assetId: asset.id || detail.workorder.assetId || undefined,
    unitNo: asset.unitNo || asset.name || "",
    vin: asset.vin || detail.workorder.formData?.vinNo || "",
    make: asset.make || "",
    model: asset.model || detail.workorder.formData?.model || "",
    year: asset.year || undefined,
    engine: asset.engine || detail.workorder.formData?.engine || "",
    engineSerial: asset.engineSerial || detail.workorder.formData?.engineSerial || "",
  };
}

export function purchasingLocation(detail) {
  const name = detail.workorder.location?.name || "Chino";
  return {
    country: "US",
    city: name.replace(/\s+yard$/i, "") || "Chino",
    region: "CA",
    timezone: "America/Los_Angeles",
  };
}

export function statusText(value) {
  return String(value || "").replaceAll("_", " ");
}

export function requestUomCode(request) {
  return normalizeUomCode(request?.uomCode);
}

export function createOfficeReviewState(request) {
  const uomCode = requestUomCode(request);
  const firstInventory = request.inventory.find(
    (item) => item.uomCode === uomCode && item.quantityAvailable > 0,
  );

  return {
    form: {
      partNumber: request.partNumber,
      manufacturer: request.manufacturer,
      description: request.description,
      category: request.category,
      quantity: request.quantity,
      uomCode,
      repairOrder: request.repairOrder,
      fitmentStatus: request.fitmentStatus,
      fitmentNotes: request.fitmentNotes,
      reason: "",
    },
    allocations: [firstInventory ? {
      sourceType: "inventory",
      status: "reserved",
      quantity: Math.min(request.quantity, firstInventory.quantityAvailable),
      uomCode,
      inventoryItemId: firstInventory.id,
      locationId: firstInventory.locationId,
      vendor: "",
    } : {
      sourceType: "unknown",
      status: "proposed",
      quantity: request.quantity,
      uomCode,
      vendor: "",
    }],
  };
}

export function officeQueueText(requests) {
  const reviewCount = requests.filter((request) => request.approvalStatus === "submitted").length;
  const clarificationCount = requests.filter((request) => request.approvalStatus === "needs_info").length;
  return [
    reviewCount ? `${reviewCount} request${reviewCount === 1 ? "" : "s"} need review` : "",
    clarificationCount ? `${clarificationCount} waiting for mechanic` : "",
  ].filter(Boolean).join(" · ") || "No pending part requests";
}
