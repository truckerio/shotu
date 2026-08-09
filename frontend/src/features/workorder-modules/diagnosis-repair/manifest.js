import { ClipboardCheck } from "@untitledui/icons";

export const diagnosisRepairModuleManifest = Object.freeze({
  id: "diagnosisRepair",
  icon: ClipboardCheck,
  policyKey: "diagnosisRepair",
  label: "Diagnosis and repair",
  owner: "workorder-modules/diagnosis-repair",
  routeBySurface: Object.freeze({ detail: "diagnosisRepair" }),
  orderBySurface: Object.freeze({ detail: 15 }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
