import { normalizeUomCode } from "../../../../shared/units-of-measure.js";

function text(value) {
  return String(value || "").trim();
}

function initialFieldChanged(form, initialForm, field) {
  return Object.hasOwn(initialForm, field) && text(form[field]) !== text(initialForm[field]);
}

function filledParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => text(part?.partNo) || text(part?.qty) || text(part?.repairOrder))
    .map((part) => ({
      ...(part?.catalogPartId ? { catalogPartId: part.catalogPartId } : {}),
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
  selectedVehicle,
}) {
  return {
    companyId: actor.companyMemberships?.[0]?.companyId || actor.companyIds?.[0] || "",
    locationId: form.locationId || actor.locationIds?.[0] || null,
    assetId: selectedVehicle?.id || null,
    concern: text(form.mechanicConcern),
    officeNotes: text(form.officeNotes),
    mechanicUserIds: [...new Set(mechanicUserIds.filter(Boolean))],
    formData: {
      companyName: text(form.customerCompanyName),
      customerCompanyName: text(form.customerCompanyName),
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
      mechanicName: text(form.mechanicName),
      startTime: text(form.startTime),
      endTime: text(form.endTime),
      managerName: text(form.managerName),
      customerSignature: text(form.customerSignature),
      authorizedBy: text(form.authorizedBy),
      parts: filledParts(form.parts),
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
    || text(form.unitNo)
    || text(form.unitType)
    || text(form.licenseNo)
    || text(form.mileage)
    || text(form.model)
    || text(form.vinNo)
    || text(form.mechanicName)
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
  const saved = payload?.formData || {};
  const savedParts = Array.isArray(saved.parts)
    ? saved.parts.map((part) => ({ ...part, uomCode: normalizeUomCode(part?.uomCode) }))
    : [];
  return {
    ...currentForm,
    ...saved,
    locationId: payload?.locationId || currentForm.locationId,
    customerCompanyName: saved.customerCompanyName || saved.companyName || "",
    mechanicConcern: saved.mechanicConcern || payload?.concern || "",
    officeNotes: payload?.officeNotes || "",
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
