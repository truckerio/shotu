import { Users01 } from "@untitledui/icons";

export const assignmentModuleManifest = Object.freeze({
  id: "assignment",
  icon: Users01,
  policyKey: "assignment",
  label: "Assignment",
  owner: "workorder-modules/assignment",
  routeBySurface: Object.freeze({ create: "assignment", detail: "assignment" }),
  orderBySurface: Object.freeze({ create: 50, detail: 55 }),
  compactPlacement: Object.freeze({ admin: "overflow", mechanic: "overflow", office: "overflow", surveillance: "overflow" }),
});
