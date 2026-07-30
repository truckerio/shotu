export function locationHasTemplate(location) {
  if (location?.has_template || location?.hasTemplate) return true;
  return [
    "header_title",
    "brand_top",
    "brand_bottom",
    "warranty_text",
    "responsibility_text",
    "authorization_text",
  ].some((field) => String(location?.[field] || "").trim());
}
