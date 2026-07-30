import {
  resolveCreateLocation,
  templateFieldsFromLocationTemplate,
} from "../create-workorder/create-workorder-utils.js";

export function canonicalDetailPreviewTemplate(workorder = {}, availableLocations = []) {
  const locationEntry = resolveCreateLocation(
    availableLocations,
    workorder.locationId || workorder.location?.id,
  );
  if (locationEntry?.template) {
    return templateFieldsFromLocationTemplate(locationEntry.template);
  }
  const locationName = String(
    workorder.location?.name || locationEntry?.location?.name || "",
  ).trim();
  return locationName
    ? { headerTitle: `${locationName.toUpperCase()} WORKORDER` }
    : {};
}
