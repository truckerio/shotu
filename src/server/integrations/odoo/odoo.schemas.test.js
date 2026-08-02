import assert from "node:assert/strict";
import test from "node:test";
import { odooPartsFromForm } from "./odoo.repo.js";
import {
  odooListSchema,
  odooResultSchema,
  odooWorkorderIdSchema,
} from "./odoo.schemas.js";

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

test("Odoo workorder paths require UUIDs", () => {
  assert.equal(
    odooWorkorderIdSchema.parse("2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60"),
    "2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60",
  );
  assert.throws(() => odooWorkorderIdSchema.parse("not-a-workorder-id"));
});

test("Odoo parts omit empty editor rows while preserving recorded rows", () => {
  assert.deepEqual(odooPartsFromForm({
    parts: [
      { partNo: "HOSE-9081", qty: "1", uomCode: "pc", repairOrder: "Replace hose" },
      { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
    ],
  }), [{
    partNo: "HOSE-9081",
    qty: "1",
    uomCode: "pc",
    repairOrder: "Replace hose",
  }]);
});
