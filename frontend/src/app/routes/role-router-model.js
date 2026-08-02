import { normalizeUsedParts } from "../../components/workorders/used-parts-model.js";
import { resolveMechanicProgressFields } from "../../features/mechanic/progress/mechanic-progress-fields.js";
import { splitSerial } from "../../features/create-workorder/create-workorder-utils.js";
import { canonicalApprovalName, canonicalPreviewTimes } from "../../features/workorder-detail/workorder-handoff.js";
import { canonicalDetailPreviewTemplate } from "../../features/workorder-detail/workorder-preview-template.js";
import { createInitialKnownParts } from "../../features/generator/create-known-parts.js";
import { todayIso } from "../../features/create-workorder/create-workorder-utils.js";

const DEFAULT_TEMPLATE = {
  headerTitle: "CHINO YARD WORKORDER",
  brandTop: "PRO TEC",
  brandBottom: "REPAIR",
  warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
  responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
  authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
};

export function createInitialDraftBaseline(actor) {
  const date = todayIso();
  return {
    locationId: actor.locationIds?.[0] || "",
    workStartDate: date,
    workEndDate: date,
    formData: { ...DEFAULT_TEMPLATE },
  };
}

export function createInitialWorkorderForm(actor) {
  const date = todayIso();
  return {
    companyName: "",
    customerCompanyName: "",
    locationId: actor.locationIds?.[0] || "",
    locationName: "",
    ...DEFAULT_TEMPLATE,
    prefix: "WO-",
    nextNumber: 1,
    digits: 6,
    copies: 1,
    workDate: date,
    workStartDate: date,
    workEndDate: date,
    unitNo: "",
    unitType: "",
    licenseNo: "",
    mileage: "",
    model: "",
    vinNo: "",
    mechanicConcern: "",
    diagnosis: "",
    workPerformed: "",
    mechanicName: actor.role === "mechanic" ? actor.name || "" : "",
    startTime: "",
    endTime: "",
    managerName: "",
    officeNotes: "",
    customerSignature: "",
    authorizedBy: "",
    parts: createInitialKnownParts(),
  };
}

export function resetWorkorderFormForCreate(current, actor, date = todayIso()) {
  return {
    ...current,
    customerCompanyName: "",
    unitNo: "",
    unitType: "",
    licenseNo: "",
    mileage: "",
    model: "",
    vinNo: "",
    mechanicConcern: "",
    diagnosis: "",
    workPerformed: "",
    mechanicName: actor.role === "mechanic" ? actor.name || "" : "",
    startTime: "",
    endTime: "",
    managerName: "",
    officeNotes: "",
    customerSignature: "",
    authorizedBy: "",
    workDate: date,
    workStartDate: date,
    workEndDate: date,
    parts: createInitialKnownParts(),
  };
}

export function vehicleMileage(vehicle) {
  if (vehicle.last_odometer_miles) return String(Math.round(Number(vehicle.last_odometer_miles)));
  if (vehicle.last_odometer_meters) return String(Math.round(Number(vehicle.last_odometer_meters) / 1609.344));
  return "";
}

export function vehicleModelText(vehicle) {
  const seen = new Set();
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .filter((value) => {
      const key = String(value).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

export function workorderDraftOwnerId(draft) {
  return draft?.owner?.id || draft?.ownerId || draft?.createdBy?.id || draft?.creator?.id || "";
}

export function createDraftBaselineFromForm(form) {
  return {
    locationId: form.locationId || "",
    workStartDate: form.workStartDate,
    workEndDate: form.workEndDate,
    formData: {
      headerTitle: form.headerTitle,
      brandTop: form.brandTop,
      brandBottom: form.brandBottom,
      warrantyText: form.warrantyText,
      responsibilityText: form.responsibilityText,
      authorizationText: form.authorizationText,
    },
  };
}

export function workorderFormValues({ detail, current, officeLocations }) {
  const workorder = detail.workorder;
  const asset = workorder.asset || {};
  const savedForm = workorder.formData || {};
  const serial = splitSerial(workorder.serial);
  const model = [asset.year, asset.make, asset.model].filter(Boolean).join(" ");
  const savedParts = normalizeUsedParts(savedForm.parts);
  const assignedMechanicName = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
    || workorder.mechanic?.name
    || (detail.user?.role === "mechanic" ? detail.user.name : "");
  const approvalName = canonicalApprovalName(workorder);
  const mechanicProgressFields = resolveMechanicProgressFields(workorder, savedForm);
  const canonicalPreviewTemplate = canonicalDetailPreviewTemplate(workorder, officeLocations);

  return {
    ...current,
    ...savedForm,
    ...canonicalPreviewTemplate,
    ...serial,
    copies: 1,
    locationId: workorder.locationId || workorder.location?.id || current.locationId,
    companyName: savedForm.customerCompanyName || savedForm.companyName || asset.ownerName || asset.owner_name || "",
    customerCompanyName: savedForm.customerCompanyName || savedForm.companyName || asset.ownerName || asset.owner_name || "",
    unitNo: savedForm.unitNo || asset.unitNo || asset.name || "",
    unitType: savedForm.unitType || asset.unitType || "",
    licenseNo: savedForm.licenseNo || asset.licensePlate || "",
    mileage: savedForm.mileage || (asset.lastOdometerMiles ? String(Math.round(Number(asset.lastOdometerMiles))) : ""),
    model: savedForm.model || model,
    vinNo: savedForm.vinNo || asset.vin || "",
    mechanicConcern: savedForm.mechanicConcern || workorder.concern || "",
    ...mechanicProgressFields,
    mechanicName: assignedMechanicName || savedForm.mechanicName,
    officeNotes: workorder.officeNotes || savedForm.officeNotes || "",
    managerName: approvalName || savedForm.managerName || "",
    authorizedBy: approvalName || savedForm.authorizedBy || "",
    ...canonicalPreviewTimes(workorder),
    parts: savedParts,
  };
}
