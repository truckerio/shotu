export const MECHANIC_PRIMARY_TABS = Object.freeze([
  { key: "myWork", label: "My work", countKey: "mine", actionLabel: "Finish / open" },
  { key: "openWork", label: "Available", countKey: "open", actionLabel: "Accept" },
]);

export const MECHANIC_SECONDARY_TABS = Object.freeze([
  { key: "waiting", label: "Waiting", countKey: "waiting" },
  { key: "done", label: "History", countKey: "done" },
  { key: "activeWork", label: "All active", countKey: "active" },
]);

export function mechanicActionLabel(activeTab) {
  if (activeTab === "myWork") return "Open";
  if (activeTab === "openWork") return "Accept";
  if (activeTab === "activeWork") return "Join";
  return "Open";
}
