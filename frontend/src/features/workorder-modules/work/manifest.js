import { Tool02 } from "@untitledui/icons";

export const concernModuleManifest = Object.freeze({
  id: "concern",
  icon: Tool02,
  policyKey: "concern",
  label: "Concern",
  owner: "workorder-modules/work",
  routeBySurface: Object.freeze({ create: "concern", detail: "concern" }),
  orderBySurface: Object.freeze({ create: 30, detail: 10 }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
