export const ADMIN_MOBILE_DESTINATIONS = [
  { key: "locations", label: "Locations", view: "locations" },
  { key: "users", label: "Users", view: "locations", tab: "users", requiresLocation: true },
  { key: "template", label: "Templates", view: "locations", tab: "template", requiresLocation: true },
  { key: "settings", label: "System", view: "settings" },
  { key: "operations", label: "Ops", view: "operations", secondary: true },
];

export function initialAdminView(search = "") {
  const params = new URLSearchParams(search);
  if (params.has("samsara") || params.get("adminView") === "settings") return "settings";
  if (params.get("adminView") === "operations") return "operations";
  return "locations";
}

export function adminMobileDestinationState({ view, tab, selectedId }, destination) {
  if (destination.view !== view) return false;
  if (!destination.tab) {
    return view !== "locations" || !selectedId || !["users", "template"].includes(tab);
  }
  return Boolean(selectedId) && destination.tab === tab;
}

export function adminLocationTarget(selectedId, locations) {
  return selectedId || locations[0]?.id || null;
}
