export function requestValue(request, ...keys) {
  for (const key of keys) {
    const value = request?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function clampPartRequestPage(page, pageCount) {
  const lastPage = Math.max(1, Number(pageCount) || 1);
  return Math.min(Math.max(1, Number(page) || 1), lastPage);
}

function requestLabel(value, fallback) {
  return String(value || fallback).replaceAll("_", " ");
}

export function partRequestRowModel(request = {}) {
  const workorder = request.workorder || {};
  const part = request.part || request.catalogPart || {};
  const destinationLocation = request.destinationLocation || {};
  const partNumber = requestValue(request, "partNumber") || part.partNumber || "";
  const partDescription = requestValue(request, "partDescription", "partName")
    || part.description
    || requestValue(request, "description", "query")
    || "Unspecified part";
  const quantity = requestValue(request, "quantity", "requestedQuantity") || part.quantity || "—";
  const unit = requestValue(request, "uomCode", "unit") || part.uomCode || "pc";
  const supplied = Number(request.suppliedQuantity) || 0;
  const availability = request.availability || {};
  const supply = [
    request.supplySummary || request.supplyStatus || "",
    availability.localQuantity !== undefined ? `Local ${availability.localQuantity}` : "",
    availability.networkQuantity !== undefined ? `Network ${availability.networkQuantity}` : "",
    supplied ? `${supplied} supplied` : "",
  ].filter(Boolean).join(" · ") || "Supply not assessed";

  return {
    id: request.id,
    workorderId: requestValue(request, "workorderId", "workorder_id") || workorder.id || "",
    partNumber,
    partDescription,
    quantity,
    unit,
    workorderLabel: requestValue(request, "workorderSerial", "serial") || workorder.serial || "No workorder number",
    unitLabel: requestValue(request, "unitNo", "unitNumber") || workorder.unitLabel || "No unit",
    destination: requestValue(request, "destination") || destinationLocation.locationName || requestValue(request, "destinationName") || "No destination",
    requester: request.requester?.name || requestValue(request, "requesterName", "requestedByName") || "Unknown requester",
    supply: requestLabel(supply, "Supply not assessed"),
    status: requestLabel(requestValue(request, "status", "state", "approvalStatus"), "requested"),
    nextAction: requestValue(request, "nextAction", "next_action") || "Review request",
    waitingSeconds: requestValue(request, "waitingSeconds", "timeWaitingSeconds", "timeInStatusSeconds"),
    lastActivityAt: requestValue(request, "lastActivityAt", "updatedAt", "createdAt"),
  };
}
