import { FileSearch01 } from "@untitledui/icons";

export const previewModuleManifest = Object.freeze({
  id: "preview",
  icon: FileSearch01,
  policyKey: "preview",
  label: "Preview",
  owner: "workorder-modules/preview",
  routeBySurface: Object.freeze({ create: "preview", detail: "preview" }),
  orderBySurface: Object.freeze({ create: 70, detail: 80 }),
  placementBySurface: Object.freeze({ create: "supporting", detail: "supporting" }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
