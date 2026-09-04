export const ADMIN_MOBILE_DESTINATIONS = [
  { key: "units", label: "Units", view: "units" },
  { key: "inventory", label: "Inventory", view: "inventory" },
  { key: "locations", label: "Locations", view: "locations" },
  { key: "modules", label: "Modules", view: "modules" },
  { key: "settings", label: "Settings", view: "settings" },
  { key: "operations", label: "Ops", view: "operations", secondary: true },
];

export function canonicalAdminSearch(search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("adminView");
  if (view === "surveillance") {
    params.set("adminView", "operations");
    params.set("category", "odoo_backlog");
  } else if (view === "invoices") {
    params.set("adminView", "inventory");
    params.set("view", "inventory");
  } else if (view === "templates") {
    params.set("adminView", "settings");
    params.set("settingsTab", "templates");
  } else {
    return search;
  }
  return `?${params.toString()}`;
}

export function initialAdminView(search = "") {
  const params = new URLSearchParams(search);
  if (params.has("samsara") || params.get("adminView") === "settings") return "settings";
  if (params.get("adminView") === "modules") return "modules";
  if (params.get("adminView") === "templates") return "settings";
  if (params.get("adminView") === "invoices") return "inventory";
  if (params.get("adminView") === "inventory") return "inventory";
  if (params.get("adminView") === "units") return "units";
  if (params.get("adminView") === "surveillance") return "operations";
  if (params.get("adminView") === "operations") return "operations";
  return "locations";
}

export function adminMobileDestinationState({ view }, destination) {
  return destination.view === view;
}
