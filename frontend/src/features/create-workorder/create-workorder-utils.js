import { independentSerializedPartRows } from "../workorder-modules/parts/create-parts-model.js";

export function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function splitSerial(serial = "") {
  const match = /^(.*?)(\d+)$/.exec(serial.trim());
  if (!match) return { prefix: "WO-", nextNumber: 1, digits: 6 };
  return { prefix: match[1], nextNumber: Number(match[2]), digits: match[2].length };
}

export function normalizeVehicleLookupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function vehicleLookupValues(vehicle) {
  return [vehicle?.unit_no, vehicle?.unitNo, vehicle?.name]
    .map(normalizeVehicleLookupValue)
    .filter(Boolean);
}

export function uniqueExactVehicleMatch(vehicles, query) {
  const normalizedQuery = normalizeVehicleLookupValue(query);
  if (!normalizedQuery) return null;
  const matches = vehicles.filter((vehicle) => vehicleLookupValues(vehicle).includes(normalizedQuery));
  return matches.length === 1 ? matches[0] : null;
}

export function resolveCreateLocation(locations = [], value = "") {
  const locationValue = String(value || "").trim();
  if (!locationValue) return null;
  const normalizedName = locationValue.toLowerCase();
  return locations.find((entry) => {
    const location = entry.location || {};
    return String(location.id || "").trim() === locationValue
      || String(location.name || "").trim().toLowerCase() === normalizedName;
  }) || null;
}

export function selectedCreateMechanicNames(assignment = {}) {
  const selectedIds = new Set(assignment.mechanicUserIds || []);
  if (!selectedIds.size) return "";

  return (assignment.mechanics || [])
    .filter((mechanic) => selectedIds.has(mechanic.id))
    .map((mechanic) => mechanic.displayName || mechanic.display_name || mechanic.name || mechanic.username)
    .filter(Boolean)
    .join(", ");
}

export function createWorkorderPreviewForm(form = {}, assignment = {}) {
  return {
    ...form,
    ...(Array.isArray(form.parts) ? { parts: independentSerializedPartRows(form.parts) } : {}),
    mechanicName: selectedCreateMechanicNames(assignment),
  };
}

const DEFAULT_TEMPLATE_FIELDS = Object.freeze({
  brandTop: "PRO TEC",
  brandBottom: "REPAIR",
  warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
  responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
  authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
});

export function templateFieldsFromLocationTemplate(template) {
  if (!template) return {};
  return {
    headerTitle: template.header_title,
    brandTop: template.brand_top,
    brandBottom: template.brand_bottom,
    warrantyText: template.warranty_text,
    responsibilityText: template.responsibility_text,
    authorizationText: template.authorization_text,
  };
}

export function templateFieldsForCreateLocation(location, template) {
  if (template) return templateFieldsFromLocationTemplate(template);
  const locationName = String(location?.name || "").trim();
  return {
    ...DEFAULT_TEMPLATE_FIELDS,
    headerTitle: locationName ? `${locationName.toUpperCase()} WORKORDER` : "WORKORDER",
  };
}

export function createLocationDefaultPatch({
  currentLocationId = "",
  defaultLocation,
  locations = [],
  template,
} = {}) {
  const currentLocation = resolveCreateLocation(locations, currentLocationId);
  if (currentLocation?.location?.id) {
    return {
      locationId: currentLocation.location.id,
      locationName: currentLocation.location.name || "",
    };
  }
  if (!defaultLocation?.id) return {};
  return {
    locationId: defaultLocation.id,
    locationName: defaultLocation.name || "",
    ...templateFieldsForCreateLocation(defaultLocation, template),
  };
}

export function createLocationTemplatePatch(form = {}, locations = []) {
  const selectedLocation = resolveCreateLocation(locations, form.locationId);
  if (!selectedLocation?.location?.id) return {};

  const nextFields = {
    locationId: selectedLocation.location.id,
    locationName: selectedLocation.location.name || "",
    ...templateFieldsForCreateLocation(selectedLocation.location, selectedLocation.template),
  };

  return Object.fromEntries(
    Object.entries(nextFields).filter(([field, value]) => String(form[field] || "") !== String(value || "")),
  );
}
