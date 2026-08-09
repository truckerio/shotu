import { Camera01 } from "@untitledui/icons";

export const photosModuleManifest = Object.freeze({
  id: "photos",
  icon: Camera01,
  policyKey: "photos",
  label: "Photos",
  owner: "workorder-modules/photos",
  routeBySurface: Object.freeze({ detail: "photos" }),
  orderBySurface: Object.freeze({ detail: 35 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "overflow" }),
});
