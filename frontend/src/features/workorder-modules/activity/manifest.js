import { ClockRewind } from "@untitledui/icons";

export const activityModuleManifest = Object.freeze({
  id: "activity",
  icon: ClockRewind,
  policyKey: "activity",
  label: "Activity",
  owner: "workorder-modules/activity",
  routeBySurface: Object.freeze({ detail: "activity" }),
  orderBySurface: Object.freeze({ detail: 70 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "primary" }),
});
