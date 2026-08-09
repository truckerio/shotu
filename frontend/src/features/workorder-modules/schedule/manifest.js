import { CalendarDate } from "@untitledui/icons";

export const scheduleModuleManifest = Object.freeze({
  id: "schedule",
  icon: CalendarDate,
  policyKey: "schedule",
  label: "Schedule",
  owner: "workorder-modules/schedule",
  routeBySurface: Object.freeze({ create: "schedule", detail: "schedule" }),
  orderBySurface: Object.freeze({ create: 20, detail: 60 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "overflow" }),
});
