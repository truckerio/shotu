import { Package } from "@untitledui/icons";

export const partsModuleManifest = Object.freeze({
  id: "parts",
  icon: Package,
  policyKey: "parts",
  label: "Parts",
  owner: "workorder-modules/parts",
  routeBySurface: Object.freeze({ create: "parts", detail: "parts" }),
  orderBySurface: Object.freeze({ create: 60, detail: 30 }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
