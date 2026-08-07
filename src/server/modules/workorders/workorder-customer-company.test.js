import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWorkorderFormData,
  renderWorkorderPageHtml,
  resolveCustomerCompanyName,
} from "../../../../shared/workorder-template.js";
import { publicWorkorderRow } from "../../db/repositories/operational-workorders.repo.js";
import {
  createWorkorderSchema,
  updateOfficeWorkorderSchema,
  workorderFormDataSchema,
} from "./workorder.schemas.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

test("canonical customer snapshot wins over legacy and asset owner values", () => {
  assert.equal(resolveCustomerCompanyName({
    customerCompanyName: "Current Customer",
    companyName: "Legacy Customer",
  }, "Asset Owner"), "Current Customer");
});

test("legacy companyName remains readable and is promoted to the canonical snapshot", () => {
  const normalized = normalizeWorkorderFormData({ companyName: "  Legacy Fleet  " }, {
    assetOwnerName: "Current Asset Owner",
  });

  assert.equal(normalized.companyName, "  Legacy Fleet  ");
  assert.equal(normalized.customerCompanyName, "Legacy Fleet");
});

test("asset owner initializes a missing snapshot without using tenant or location names", () => {
  assert.equal(normalizeWorkorderFormData({
    locationName: "Chino Yard",
    tenantName: "Shotu",
  }, {
    assetOwnerName: "Long Haul LLC",
  }).customerCompanyName, "Long Haul LLC");

  assert.equal(normalizeWorkorderFormData({
    locationName: "Chino Yard",
    tenantName: "Shotu",
  }).customerCompanyName, "");
});

test("an explicit blank snapshot prevents a legacy location adapter from becoming the customer", () => {
  const persisted = normalizeWorkorderFormData({});
  const legacyPrintAdapter = { ...persisted, companyName: "Chino Yard" };
  const html = renderWorkorderPageHtml(legacyPrintAdapter, "WO-000001");

  assert.match(
    html,
    /Customer Company:<\/span><strong class="wo-value"><\/strong>/,
  );
});

test("workorder schemas type and normalize customerCompanyName while preserving other printable keys", () => {
  const parsedForm = workorderFormDataSchema.parse({
    customerCompanyName: "  Acme Trucking  ",
    headerTitle: "CHINO YARD WORKORDER",
  });
  assert.equal(parsedForm.customerCompanyName, "Acme Trucking");
  assert.equal(parsedForm.headerTitle, "CHINO YARD WORKORDER");

  const created = createWorkorderSchema.parse({
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    concern: "Inspect air leak.",
    formData: { companyName: "Legacy Fleet" },
  });
  assert.equal(created.formData.customerCompanyName, "Legacy Fleet");

  const updated = updateOfficeWorkorderSchema.parse({
    formData: { customerCompanyName: "New Owner" },
  });
  assert.equal(updated.formData.customerCompanyName, "New Owner");
});

test("create and office snapshots enforce part quantity units", () => {
  assert.throws(() => createWorkorderSchema.parse({
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    concern: "Invalid count quantity.",
    formData: { parts: [{ partNo: "FILTER", qty: "1.5", uomCode: "ea" }] },
  }), /valid quantity/i);
  assert.throws(() => updateOfficeWorkorderSchema.parse({
    formData: { parts: [{ partNo: "OIL", qty: "1", uomCode: "unknown" }] },
  }), /valid unit/i);

  const valid = createWorkorderSchema.parse({
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    concern: "Measured fluid quantity.",
    formData: { parts: [{ partNo: "OIL", qty: "1.5", uomCode: "gal" }] },
  });
  assert.equal(valid.formData.parts[0].uomCode, "gal");
});

test("public workorder projection exposes asset owner and a canonical form snapshot", () => {
  const workorder = publicWorkorderRow({
    id: "33333333-3333-4333-8333-333333333333",
    company_id: COMPANY_ID,
    serial: "WO-000001",
    asset_id: "44444444-4444-4444-8444-444444444444",
    location_id: LOCATION_ID,
    form_data: {},
    asset: {
      id: "44444444-4444-4444-8444-444444444444",
      unitNo: "G2025",
      ownerName: "Acme Logistics",
    },
    location: {
      id: LOCATION_ID,
      name: "Chino Yard",
    },
    mechanics: [],
    mechanic_ids: [],
    odoo_status: "entered",
    odoo_service_order_no: "S00016",
    odoo_external_id: "13380",
    odoo_base_url: "https://protec.example.odoo.com",
    odoo_target_model: "sale.order",
  });

  assert.equal(workorder.asset.ownerName, "Acme Logistics");
  assert.equal(workorder.formData.customerCompanyName, "Acme Logistics");
  assert.notEqual(workorder.formData.customerCompanyName, workorder.location.name);
  assert.equal(workorder.odooStatus, "entered");
  assert.equal(workorder.odooServiceOrderNo, "S00016");
  assert.equal(workorder.odooExternalId, "13380");
  assert.equal(
    workorder.odooUrl,
    "https://protec.example.odoo.com/web#id=13380&model=sale.order&view_type=form",
  );
});

test("public workorder projection supplies safe Odoo tracking defaults", () => {
  const workorder = publicWorkorderRow({ form_data: {}, mechanics: [], mechanic_ids: [] });

  assert.equal(workorder.odooStatus, "not_entered");
  assert.equal(workorder.odooServiceOrderNo, "");
  assert.equal(workorder.odooExternalId, "");
  assert.equal(workorder.odooUrl, "");
});

test("print uses the canonical label and supports legacy workorders", () => {
  const legacyHtml = renderWorkorderPageHtml({ companyName: "Legacy Fleet" }, "WO-000001");
  assert.match(legacyHtml, /Customer Company:/);
  assert.match(legacyHtml, /Legacy Fleet/);
  assert.doesNotMatch(legacyHtml, /Company Name:/);
});
