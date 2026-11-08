const screens = new Set(['repair', 'chat', 'document']);
export function repairScreenFromLocation(location) {
  const screen = new URLSearchParams(location?.search || '').get('repairView');
  return screens.has(screen) ? screen : 'repair';
}
export function repairDocumentFromLocation(location) {
  return new URLSearchParams(location?.search || "").get("repairDocument") === "invoice" ? "invoice" : "estimate";
}
export function repairScreenUrl(currentUrl, screen, documentType = "estimate") {
  const url = new URL(currentUrl);
  if (!screens.has(screen) || screen === 'repair') url.searchParams.delete('repairView');
  else url.searchParams.set('repairView', screen);
  if (screen === "document") url.searchParams.set("repairDocument", documentType === "invoice" ? "invoice" : "estimate");
  else url.searchParams.delete("repairDocument");
  // The capability remains in the fragment, never copied into a query parameter.
  return `${url.pathname}${url.search}${url.hash}`;
}
