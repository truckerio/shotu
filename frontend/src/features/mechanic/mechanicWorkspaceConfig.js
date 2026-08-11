export const MECHANIC_QUEUE_TABS = Object.freeze([
  { key: "myWork", label: "My work", labelKey: "mechanic.myWork", countKey: "mine", actionLabel: "Finish / open", phonePrimary: true },
  { key: "openWork", label: "Available", labelKey: "mechanic.availableJobs", countKey: "open", actionLabel: "Accept", phonePrimary: true },
  { key: "waiting", label: "Waiting", labelKey: "mechanic.waiting", countKey: "waiting", phonePrimary: true },
  { key: "done", label: "History", labelKey: "mechanic.history", countKey: "done", phonePrimary: false },
  { key: "activeWork", label: "All active", labelKey: "mechanic.allActive", countKey: "active", phonePrimary: false },
]);

export function mechanicQueueTabsForViewport(compact = false) {
  if (!compact) return { primary: MECHANIC_QUEUE_TABS, secondary: [] };
  return {
    primary: MECHANIC_QUEUE_TABS.filter((tab) => tab.phonePrimary),
    secondary: MECHANIC_QUEUE_TABS.filter((tab) => !tab.phonePrimary),
  };
}

export function mechanicActionLabel(activeTab) {
  if (activeTab === "myWork") return "Open";
  if (activeTab === "openWork") return "Accept";
  if (activeTab === "activeWork") return "Join";
  return "Open";
}
