import { CheckCircle } from "@untitledui/icons";

export const completionModuleManifest = Object.freeze({
  id: "completion",
  icon: CheckCircle,
  policyKey: "completion",
  label: "Completion",
  owner: "workorder-modules/completion",
  routeBySurface: Object.freeze({ detail: "completion" }),
  orderBySurface: Object.freeze({ detail: 90 }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
