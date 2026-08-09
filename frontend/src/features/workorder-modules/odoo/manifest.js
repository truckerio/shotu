import { Database01 } from "@untitledui/icons";

export const odooModuleManifest = Object.freeze({
  id: "odoo",
  icon: Database01,
  policyKey: "odoo",
  label: "Odoo",
  owner: "workorder-modules/odoo",
  routeBySurface: Object.freeze({ detail: "odoo" }),
  orderBySurface: Object.freeze({ detail: 100 }),
  compactPlacement: Object.freeze({ admin: "primary", office: "primary", surveillance: "primary" }),
});
