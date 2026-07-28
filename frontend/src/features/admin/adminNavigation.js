export const ADMIN_MOBILE_DESTINATIONS = [
  { key: "locations", label: "Locations", view: "locations" },
  { key: "settings", label: "System", view: "settings" },
  { key: "operations", label: "Ops", view: "operations", secondary: true },
];

export function initialAdminView(search = "") {
  const params = new URLSearchParams(search);
  if (params.has("samsara") || params.get("adminView") === "settings") return "settings";
  if (params.get("adminView") === "operations") return "operations";
  return "locations";
}

export function adminMobileDestinationState({ view }, destination) {
  return destination.view === view;
}
