import { useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { normalizeUomCode } from "../../../../../shared/units-of-measure.js";
import { catalogInventoryText } from "./catalog-parts-model.js";
import {
  ALLOCATION_STATUS_LABELS,
  createOfficeReviewState,
  purchasingLocation,
  requestUomCode,
  vehicleInput,
  partRequestLabel,
} from "./part-request-model.js";
import { interfaceText } from "../../../i18n/index.js";

export function useOfficeRequestReview({ request, detail, onChanged, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
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

  function updatePartNumber(value) {
    setForm((current) => ({ ...current, catalogPartId: null, partNumber: value }));
    setAllocations([{
      sourceType: "unknown",
      status: "proposed",
      quantity: form.quantity,
      uomCode: form.uomCode,
      vendor: "",
    }]);
  }

  function selectCatalogPart(part) {
    const uomCode = normalizeUomCode(part.uomCode || form.uomCode);
    const quantity = Number(form.quantity) || 1;
    setForm((current) => ({
      ...current,
      catalogPartId: part.id,
      partNumber: part.partNumber,
      manufacturer: part.manufacturer || current.manufacturer,
      description: part.description || current.description,
      category: part.category || current.category,
      quantity: current.quantity || 1,
      uomCode,
    }));
    setAllocations([part.inventory?.available > 0 && part.inventory?.itemId ? {
      sourceType: "inventory",
      status: "reserved",
      quantity: Math.min(quantity, part.inventory.available),
      uomCode,
      inventoryItemId: part.inventory.itemId,
      locationId: part.inventory.locationId || detail.workorder.locationId,
      vendor: "",
    } : {
      sourceType: "unknown",
      status: "proposed",
      quantity,
      uomCode,
      vendor: "",
    }]);
    setMessageTone("success");
    setMessage(catalogInventoryText(part));
  }

  function fail(messageText, focusResponse = false) {
    setMessageTone("error");
    setMessage(messageText);
    if (focusResponse) responseRef.current?.focus();
  }

  async function decide(decision) {
    if (decision !== "approved" && !form.reason.trim()) {
      fail(decision === "needs_info"
        ? t("parts.questionRequired")
        : t("parts.declineReasonRequired"), true);
      return;
    }
    if (decision === "approved" && !form.partNumber.trim() && !form.description.trim()) {
      fail(t("parts.partRequiredBeforeApproval"));
      return;
    }
    if (decision === "approved" && form.fitmentStatus === "conflict") {
      fail(t("parts.resolveFitmentBeforeApproval"));
      return;
    }
    const allocatedQuantity = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    if (decision === "approved" && Math.abs(allocatedQuantity - Number(form.quantity)) > 0.0005) {
      fail(`${t("parts.supplyMustTotal")} ${formatQuantityUnit(form.quantity, form.uomCode)}.`);
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
        ? t("parts.approvedNotified")
        : decision === "needs_info"
          ? t("parts.questionSent")
          : t("parts.declinedNotified"));
    } catch (error) {
      fail(locale === "en" && error?.message ? error.message : t("parts.decisionFailed"));
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
        catalogPartId: null,
        partNumber: result.part.normalizedPartNumber || current.partNumber,
        manufacturer: result.part.manufacturer || current.manufacturer,
        description: result.part.description || current.description,
        category: result.part.category || current.category,
        quantity: result.part.suggestedQuantity || current.quantity,
        uomCode: suggestedUomCode,
        fitmentStatus: result.part.fitmentStatus || "unknown",
        fitmentNotes: result.part.evidenceSummary || current.fitmentNotes,
      }));
      setAllocations((current) => current.map((allocation) => ({
        ...allocation,
        inventoryItemId: null,
        locationId: null,
        sourceType: "unknown",
        status: "proposed",
        quantity: result.part.suggestedQuantity || form.quantity,
        uomCode: suggestedUomCode,
      })));
      setMessageTone("success");
      setMessage(result.resolutionSource === "company_catalog"
        ? t("parts.matchedCompanyData")
        : t("parts.aiSuggestionLoaded"));
    } catch (error) {
      fail(locale === "en" && error?.message ? `${error.message} ${t("parts.reviewManualEntry")}` : t("parts.suggestionFailed"));
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
      setMessage(`${t("parts.supplyUpdatedTo")} ${partRequestLabel(locale, "allocation", status, ALLOCATION_STATUS_LABELS[status])}. ${t("parts.mechanicNotified")}`);
    } catch (error) {
      fail(locale === "en" && error?.message ? error.message : t("parts.allocationUpdateFailed"));
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
      fail(locale === "en" && error?.message ? error.message : t("parts.priceSearchFailed"));
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
    selectCatalogPart,
    update,
    updateAllocation,
    updateRequestUnit,
    updatePartNumber,
  };
}
