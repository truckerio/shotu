import { Truck01 } from "@untitledui/icons";

export const unitModuleManifest = Object.freeze({
  id: "unit",
  icon: Truck01,
  policyKey: "unit",
  label: "Unit",
  owner: "workorder-modules/unit",
  routeBySurface: Object.freeze({ create: "unit", detail: "unit" }),
  orderBySurface: Object.freeze({ create: 40, detail: 40 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "overflow" }),
});
