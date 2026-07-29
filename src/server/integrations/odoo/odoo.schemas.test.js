import assert from "node:assert/strict";
import test from "node:test";
import { odooListSchema, odooResultSchema } from "./odoo.schemas.js";

test("Odoo list contract applies bounded cursor pagination defaults", () => {
  assert.deepEqual(odooListSchema.parse({}), {
    status: "pending",
    limit: 100,
  });
  assert.equal(odooListSchema.parse({ status: "entered", limit: "200" }).limit, 200);
  assert.throws(() => odooListSchema.parse({ limit: "201" }));
});

test("Odoo entered result requires durable external identity", () => {
  assert.deepEqual(odooResultSchema.parse({
    status: "entered",
    serviceOrderNo: "SO-10482",
    externalId: "odoo:maintenance.request:7812",
  }), {
    status: "entered",
    serviceOrderNo: "SO-10482",
    externalId: "odoo:maintenance.request:7812",
    note: "",
  });
  assert.throws(() => odooResultSchema.parse({
    status: "entered",
    serviceOrderNo: "SO-10482",
  }));
});

test("Odoo missing-information result requires an actionable note", () => {
  assert.equal(odooResultSchema.parse({
    status: "missing_info",
    note: "Partner mapping is missing.",
  }).status, "missing_info");
  assert.throws(() => odooResultSchema.parse({ status: "missing_info", note: " " }));
});
