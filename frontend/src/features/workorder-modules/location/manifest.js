import { MarkerPin01 } from "@untitledui/icons";

export const locationModuleManifest = Object.freeze({
  id: "location",
  icon: MarkerPin01,
  policyKey: "location",
  label: "Location",
  owner: "workorder-modules/location",
  routeBySurface: Object.freeze({ create: "location", detail: "location" }),
  orderBySurface: Object.freeze({ create: 10, detail: 50 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "overflow" }),
});
