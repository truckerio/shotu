export const ADMIN_MOBILE_DESTINATIONS = [
  { key: "locations", label: "Locations", view: "locations" },
  { key: "modules", label: "Modules", view: "modules" },
  { key: "settings", label: "System", view: "settings" },
  { key: "operations", label: "Ops", view: "operations", secondary: true },
];

export function canonicalAdminSearch(search = "") {
  const params = new URLSearchParams(search);
  if (params.get("adminView") !== "surveillance") return search;
  params.set("adminView", "operations");
  params.set("category", "odoo_backlog");
  return `?${params.toString()}`;
}

export function initialAdminView(search = "") {
  const params = new URLSearchParams(search);
  if (params.has("samsara") || params.get("adminView") === "settings") return "settings";
  if (params.get("adminView") === "modules") return "modules";
  if (params.get("adminView") === "invoices") return "invoices";
  if (params.get("adminView") === "surveillance") return "operations";
  if (params.get("adminView") === "operations") return "operations";
  return "locations";
}

export function adminMobileDestinationState({ view }, destination) {
  return destination.view === view;
}
