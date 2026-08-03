import { useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { normalizeUomCode } from "../../../../../shared/units-of-measure.js";
import {
  ALLOCATION_STATUS_LABELS,
  createOfficeReviewState,
  purchasingLocation,
  requestUomCode,
  vehicleInput,
} from "./part-request-model.js";

export function useOfficeRequestReview({ request, detail, onChanged }) {
  const initial = createOfficeReviewState(request, detail.workorder.locationId);
  const [form, setForm] = useState(initial.form);
  const [allocations, setAllocations] = useState(initial.allocations);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [pricing, setPricing] = useState(null);
  const responseRef = useRef(null);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateRequestUnit(value) {
    update("uomCode", value);
    setAllocations((current) => current.map((allocation) => ({ ...allocation, uomCode: value })));
  }

  function fail(messageText, focusResponse = false) {
    setMessageTone("error");
    setMessage(messageText);
    if (focusResponse) responseRef.current?.focus();
  }

  async function decide(decision) {
    if (decision !== "approved" && !form.reason.trim()) {
      fail(decision === "needs_info"
        ? "Write the question the mechanic needs to answer."
        : "Explain why the request is being declined.", true);
      return;
    }
    if (decision === "approved" && !form.partNumber.trim() && !form.description.trim()) {
      fail("Add a part number or description before approval.");
      return;
    }
    if (decision === "approved" && form.fitmentStatus === "conflict") {
      fail("This part has conflicting fitment. Resolve the fitment before approval.");
      return;
    }
    const allocatedQuantity = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    if (decision === "approved" && Math.abs(allocatedQuantity - Number(form.quantity)) > 0.0005) {
      fail(`Supply quantities must total ${formatQuantityUnit(form.quantity, form.uomCode)}.`);
      return;
    }

    setBusy(decision);
    setMessage("");
    try {
      await api(`/api/office/workorders/${detail.workorder.id}/parts/${request.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...form,
          allocations: decision === "approved" ? allocations : [],
        }),
      });
      await onChanged();
      setMessageTone("success");
      setMessage(decision === "approved"
        ? "Approved. The mechanic was notified in chat."
        : decision === "needs_info"
          ? "Question sent to the mechanic."
          : "Request declined. The mechanic was notified.");
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  async function findSuggestion() {
    setBusy("identify");
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({
          query: form.partNumber || request.rawQuery,
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      const suggestedUomCode = normalizeUomCode(result.part.uomCode || form.uomCode);
      setForm((current) => ({
        ...current,
        partNumber: result.part.normalizedPartNumber || current.partNumber,
        manufacturer: result.part.manufacturer || current.manufacturer,
        description: result.part.description || current.description,
        category: result.part.category || current.category,
        quantity: result.part.suggestedQuantity || current.quantity,
        uomCode: suggestedUomCode,
        repairOrder: result.part.repairOrder || current.repairOrder,
        fitmentStatus: result.part.fitmentStatus || "unknown",
        fitmentNotes: result.part.evidenceSummary || current.fitmentNotes,
      }));
      setAllocations((current) => current.map((allocation) => ({
        ...allocation,
        uomCode: suggestedUomCode,
      })));
      setMessageTone("success");
      setMessage(result.resolutionSource === "company_catalog"
        ? "Matched company-approved part data."
        : "AI suggestion loaded for review. Nothing has been approved yet.");
    } catch (error) {
      fail(`${error.message} Review and enter the part manually.`);
    } finally {
      setBusy("");
    }
  }

  async function updateAllocation(allocation, status) {
    setBusy(allocation.id);
    setMessage("");
    try {
      await api(`/api/office/workorders/${detail.workorder.id}/parts/${request.id}/allocations/${allocation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await onChanged();
      setMessageTone("success");
      setMessage(`Supply updated to ${ALLOCATION_STATUS_LABELS[status]}. The mechanic was notified.`);
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  async function findPrices() {
    setBusy("prices");
    setMessage("");
    try {
      setPricing(await api("/api/parts-helper/live-prices", {
        method: "POST",
        body: JSON.stringify({
          partNumber: request.partNumber,
          manufacturer: request.manufacturer,
          description: request.description,
          quantity: request.quantity,
          uomCode: requestUomCode(request),
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      }));
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  return {
    allocations,
    busy,
    decide,
    findPrices,
    findSuggestion,
    form,
    message,
    messageTone,
    pricing,
    responseRef,
    setAllocations,
    update,
    updateAllocation,
    updateRequestUnit,
  };
}
