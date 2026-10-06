import { normalizeUomCode } from "../../../../shared/units-of-measure.js";
import { independentSerializedPartRows } from "../workorder-modules/parts/create-parts-model.js";

function text(value) {
  return String(value || "").trim();
}

function initialFieldChanged(form, initialForm, field) {
  return Object.hasOwn(initialForm, field) && text(form[field]) !== text(initialForm[field]);
}

function partHasExactInventorySource(part) {
  if (!part?.catalogPartId || part.purchaseRequested === true) return false;
  if (part.serializationRequired === true || part.trackingMode === "serialized") {
    return Array.isArray(part.serializedUnitIds) && part.serializedUnitIds.length > 0;
  }
  if (["quantity", "measured_bulk"].includes(part.trackingMode)) return Boolean(part.sourcePositionId);
  return false;
}

function filledParts(parts) {
  return independentSerializedPartRows((Array.isArray(parts) ? parts : [])
    .filter((part) => text(part?.partNo) || text(part?.qty) || text(part?.repairOrder)))
    .map((part) => ({
      ...(part?.catalogPartId ? { catalogPartId: part.catalogPartId } : {}),
      ...(part?.serializationRequired === true ? { serializationRequired: true } : {}),
      ...(part?.trackingMode ? { trackingMode: part.trackingMode } : {}),
      ...(part?.purchaseRequested === true ? { purchaseRequested: true } : {}),
      ...(part?.sourcePositionId ? {
        sourcePositionId: part.sourcePositionId,
        sourcePositionPath: text(part.sourcePositionPath),
      } : {}),
      ...(Array.isArray(part?.serializedUnitIds) && part.serializedUnitIds.length ? {
        serializedUnitIds: [...new Set(part.serializedUnitIds.filter(Boolean))],
        serializedSerialNumbers: [...new Set((part.serializedSerialNumbers || []).filter(Boolean))],
      } : {}),
      ...(["batch_cost", "selling_price"].includes(part?.priceSelection) ? {
        priceSelection: part.priceSelection,
        ...(text(part.customUnitPrice) ? { customUnitPrice: text(part.customUnitPrice) } : {}),
      } : {}),
      partNo: text(part.partNo),
      qty: text(part.qty),
      uomCode: normalizeUomCode(part.uomCode),
      repairOrder: text(part.repairOrder),
    }));
}

export function buildWorkorderDraftPayload({
  actor,
  form,
  mechanicUserIds = [],
  selectedLocation = null,
  selectedVehicle,
}) {
  const isMechanicCreate = actor.role === "mechanic";
  const selectedCompanyId = selectedLocation?.location?.company_id
    || selectedLocation?.location?.companyId
    || selectedLocation?.company_id
    || selectedLocation?.companyId
    || "";
  const parts = filledParts(form.parts);
  const financialRole = ["admin", "office"].includes(actor.role);
  const pricingParts = financialRole ? parts.flatMap((part, partIndex) => (
    partHasExactInventorySource(part) && ["batch_cost", "selling_price"].includes(part.priceSelection)
      ? [{
        partIndex,
        selection: part.priceSelection,
        ...(text(part.customUnitPrice) ? { customUnitPrice: text(part.customUnitPrice) } : {}),
      }]
      : []
  )) : [];
  const printableParts = parts.map(({ priceSelection: _priceSelection, customUnitPrice: _customUnitPrice, ...part }) => part);
  const laborSelection = financialRole && ["internal_cost", "selling_price"].includes(form.laborPriceSelection)
    ? form.laborPriceSelection
    : "";
  const laborCustomUnitPrice = text(form.laborCustomUnitPrice);
  return {
    companyId: selectedCompanyId
      || actor.companyMemberships?.[0]?.companyId
      || actor.companyIds?.[0]
      || "",
    locationId: form.locationId || actor.locationIds?.[0] || null,
    assetId: selectedVehicle?.id || null,
    concern: text(form.mechanicConcern),
    officeNotes: text(form.officeNotes),
    ...(["admin", "office"].includes(actor.role) && form.authorizationClassification ? {
      authorizationClassification: form.authorizationClassification,
      authorizationExceptionReason: ["internal_fleet", "exempt"].includes(form.authorizationClassification)
        ? text(form.authorizationExceptionReason)
        : null,
    } : {}),
    ...(!isMechanicCreate ? {
      mechanicUserIds: [...new Set(mechanicUserIds.filter(Boolean))],
    } : {}),
    ...(financialRole && (pricingParts.length || laborSelection) ? {
      pricing: {
        parts: pricingParts,
        ...(laborSelection ? {
          labor: {
            selection: laborSelection,
            ...(laborCustomUnitPrice ? { customUnitPrice: laborCustomUnitPrice } : {}),
          },
        } : {}),
      },
    } : {}),
    inventoryUnitSelections: parts.flatMap((part, partIndex) => (
      part.catalogPartId && part.serializedUnitIds?.length
        ? [{ partIndex, catalogPartId: part.catalogPartId, unitIds: part.serializedUnitIds }]
        : []
    )),
    inventoryPositionSelections: parts.flatMap((part, partIndex) => (
      part.catalogPartId && part.sourcePositionId
        ? [{ partIndex, catalogPartId: part.catalogPartId, positionId: part.sourcePositionId }]
        : []
    )),
    formData: {
      companyName: text(form.customerCompanyName),
      customerCompanyName: text(form.customerCompanyName),
      customerAccountId: text(form.customerAccountId),
      customerContactId: text(form.customerContactId),
      customerAddress: text(form.customerAddress),
      customerContactName: text(form.customerContactName),
      customerContactEmail: text(form.customerContactEmail),
      headerTitle: text(form.headerTitle),
      brandTop: text(form.brandTop),
      brandBottom: text(form.brandBottom),
      warrantyText: text(form.warrantyText),
      responsibilityText: text(form.responsibilityText),
      authorizationText: text(form.authorizationText),
      workDate: text(form.workDate),
      workStartDate: text(form.workStartDate),
      workEndDate: text(form.workEndDate),
      unitNo: text(form.unitNo),
      unitType: text(form.unitType),
      licenseNo: text(form.licenseNo),
      mileage: text(form.mileage),
      model: text(form.model),
      vinNo: text(form.vinNo),
      mechanicConcern: text(form.mechanicConcern),
      laborHours: text(form.laborHours),
      laborProduct: form.laborProduct || null,
      workPerformed: text(form.workPerformed),
      startTime: text(form.startTime),
      endTime: text(form.endTime),
      managerName: text(form.managerName),
      ...(!isMechanicCreate ? {
        mechanicName: text(form.mechanicName),
        customerSignature: text(form.customerSignature),
        authorizedBy: text(form.authorizedBy),
      } : {}),
      parts: printableParts,
    },
  };
}

export function isMeaningfulWorkorderDraft(payload, initialDates = {}) {
  const form = payload?.formData || {};
  const initialForm = initialDates.formData || {};
  return Boolean(
    (Object.hasOwn(initialDates, "locationId") && text(payload?.locationId) !== text(initialDates.locationId))
    || payload?.assetId
    || text(payload?.concern)
    || text(payload?.officeNotes)
    || payload?.mechanicUserIds?.length
    || text(form.customerCompanyName)
    || text(form.customerAccountId)
    || text(form.customerContactId)
    || text(form.customerAddress)
    || text(form.customerContactName)
    || text(form.customerContactEmail)
    || text(form.unitNo)
    || text(form.unitType)
    || text(form.licenseNo)
    || text(form.mileage)
    || text(form.model)
    || text(form.vinNo)
    || text(form.mechanicName)
    || text(form.laborHours)
    || text(form.workPerformed)
    || text(form.startTime)
    || text(form.endTime)
    || text(form.managerName)
    || text(form.customerSignature)
    || text(form.authorizedBy)
    || form.parts?.length
    || initialFieldChanged(form, initialForm, "headerTitle")
    || initialFieldChanged(form, initialForm, "brandTop")
    || initialFieldChanged(form, initialForm, "brandBottom")
    || initialFieldChanged(form, initialForm, "warrantyText")
    || initialFieldChanged(form, initialForm, "responsibilityText")
    || initialFieldChanged(form, initialForm, "authorizationText")
    || (initialDates.workStartDate && form.workStartDate !== initialDates.workStartDate)
    || (initialDates.workEndDate && form.workEndDate !== initialDates.workEndDate)
  );
}

export function formValuesFromWorkorderDraft(payload, currentForm) {
  const partSelections = new Map((Array.isArray(payload?.pricing?.parts) ? payload.pricing.parts : [])
    .filter((entry) => Number.isInteger(entry?.partIndex) && ["batch_cost", "selling_price"].includes(entry?.selection))
    .map((entry) => [entry.partIndex, entry]));
  const saved = payload?.formData || {};
  const savedParts = Array.isArray(saved.parts)
    ? independentSerializedPartRows(saved.parts)
      .map((part, partIndex) => ({
        ...part,
        uomCode: normalizeUomCode(part?.uomCode),
        ...(partSelections.has(partIndex) ? {
          priceSelection: partSelections.get(partIndex).selection,
          customUnitPrice: text(partSelections.get(partIndex).customUnitPrice),
        } : {}),
      }))
    : [];
  return {
    ...currentForm,
    ...saved,
    locationId: payload?.locationId || currentForm.locationId,
    customerCompanyName: saved.customerCompanyName || saved.companyName || "",
    customerAccountId: saved.customerAccountId || "",
    customerContactId: saved.customerContactId || "",
    customerAddress: saved.customerAddress || "",
    customerContactName: saved.customerContactName || "",
    customerContactEmail: saved.customerContactEmail || "",
    mechanicConcern: saved.mechanicConcern || payload?.concern || "",
    workPerformed: saved.workPerformed || "",
    laborPriceSelection: ["internal_cost", "selling_price"].includes(payload?.pricing?.labor?.selection)
      ? payload.pricing.labor.selection
      : "",
    laborCustomUnitPrice: text(payload?.pricing?.labor?.customUnitPrice),
    officeNotes: payload?.officeNotes || "",
    authorizationClassification: Object.hasOwn(payload || {}, "authorizationClassification")
      ? payload.authorizationClassification || ""
      : currentForm.authorizationClassification || "approval_not_required",
    authorizationExceptionReason: payload?.authorizationExceptionReason || "",
    parts: savedParts.length ? savedParts : currentForm.parts,
  };
}

export function selectedVehicleFromWorkorderDraft(payload) {
  if (!payload?.assetId) return null;
  const form = payload.formData || {};
  return {
    id: payload.assetId,
    unit_no: form.unitNo || "",
    unit_type: form.unitType || "",
    license_plate: form.licenseNo || "",
    model: form.model || "",
    vin: form.vinNo || "",
    last_odometer_miles: form.mileage || "",
    owner_name: form.customerCompanyName || form.companyName || "",
  };
}
