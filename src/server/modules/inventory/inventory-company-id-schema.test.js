import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";
import { createInventoryTaxProfileSchema, inventoryTaxProfileQuerySchema } from "./inventory.schemas.js";

test("inventory tax profile schemas accept the legacy local company identifier", () => {
  assert.equal(inventoryTaxProfileQuerySchema.parse({ companyId: DEFAULT_COMPANY_ID }).companyId, DEFAULT_COMPANY_ID);
  assert.equal(createInventoryTaxProfileSchema.parse({
    companyId: DEFAULT_COMPANY_ID,
    name: "California sales tax",
    currency: "USD",
    jurisdiction: "California",
    components: [{ name: "State", rate: "7.25", compound: false }],
    reason: "Local demo",
    idempotencyKey: "local-demo-tax",
  }).companyId, DEFAULT_COMPANY_ID);
  assert.equal(inventoryTaxProfileQuerySchema.safeParse({ companyId: "invalid" }).success, false);
});
