import assert from "node:assert/strict";
import test from "node:test";
import { readLockedWorkorderFinancialSource } from "./customer-document-workorder-source.repo.js";

const ids = {
  company: "11111111-1111-4111-8111-111111111111",
  location: "22222222-2222-4222-8222-222222222222",
  workorder: "33333333-3333-4333-8333-333333333333",
};

function client({ priceQuantity = "2.000", uomCode = "hr", snapshotUom = uomCode } = {}) {
  let call = 0;
  return {
    async query(sql) {
      call += 1;
      if (call === 1) return { rows: [{
        id: ids.workorder, company_id: ids.company, location_id: ids.location,
        status: "mechanic_done", progress_version: 7, concern: "Repair", work_performed: "Installed",
        form_data: { customerCompanyName: "Customer", laborHours: "1", laborProduct: { productId: "99999999-9999-4999-8999-999999999999", uomCode } }, unit_no: "T-1",
      }] };
      if (call === 2) return { rows: [] };
      if (call === 3) return { rows: [{
        id: "44444444-4444-4444-8444-444444444444", status: "consumed", catalog_part_id: "55555555-5555-4555-8555-555555555555",
        uom_code: "ea", effective_quantity: "2.000", part_number: "P-1", description: "Part",
        price_snapshot_id: "66666666-6666-4666-8666-666666666666", selection: "selling_price",
        unit_price: "5.0000", price_quantity: priceQuantity, total_price: "10.0000", currency: "USD",
        selling_policy_version_id: "77777777-7777-4777-8777-777777777777",
      }] };
      assert.match(sql, /workorder_labor_price_snapshots/);
      return { rows: [{
        id: "88888888-8888-4888-8888-888888888888", labor_product_id: "99999999-9999-4999-8999-999999999999",
        rate_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", selection: "selling_price", hours: "1.00",
        unit_price: "100.0000", total_price: "100.0000", currency: "USD", product_name: "Labor",
        uom_code: snapshotUom,
      }] };
    },
  };
}

test("transaction reader locks one exact Workorder source and fingerprints labor plus canonical usage prices", async () => {
  const source = await readLockedWorkorderFinancialSource({
    companyId: ids.company, locationId: ids.location, workorderId: ids.workorder,
  }, client());
  assert.equal(source.workorder.progressVersion, 7);
  assert.equal(source.parts[0].quantity, "2.000");
  assert.equal(source.labor.hours, "1.00");
  assert.match(source.pricingFingerprint, /^[0-9a-f]{64}$/);
});

test("flat labor source retains immutable unit and rejects stale hourly pricing", async () => {
  const input = { companyId: ids.company, locationId: ids.location, workorderId: ids.workorder };
  const hourly = await readLockedWorkorderFinancialSource(input, client());
  const flat = await readLockedWorkorderFinancialSource(input, client({ uomCode: "ea" }));
  assert.equal(flat.labor.uomCode, "ea");
  assert.notEqual(flat.pricingFingerprint, hourly.pricingFingerprint);
  await assert.rejects(readLockedWorkorderFinancialSource(input, client({ uomCode: "ea", snapshotUom: "hr" })), (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
});

test("transaction reader rejects a price snapshot whose quantity is stale for its usage", async () => {
  await assert.rejects(
    readLockedWorkorderFinancialSource({ companyId: ids.company, locationId: ids.location, workorderId: ids.workorder }, client({ priceQuantity: "1.000" })),
    (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED",
  );
});
