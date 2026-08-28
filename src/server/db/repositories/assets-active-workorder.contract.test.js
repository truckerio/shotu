import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./assets.repo.js", import.meta.url), "utf8");

test("asset lookup returns only same-company active workorder metadata", () => {
  assert.match(source, /left join lateral \(/i);
  assert.match(source, /from operational_workorders wo/i);
  assert.match(source, /wo\.asset_id = a\.id/i);
  assert.match(source, /wo\.company_id = a\.company_id/i);
  assert.match(source, /wo\.status not in \('closed', 'odoo_entered', 'cancelled'\)/i);
  assert.match(source, /order by wo\.created_at desc, wo\.id desc/i);
  assert.match(source, /limit 1/i);
  assert.match(source, /jsonb_build_object\([\s\S]*'id', active_workorder\.id,[\s\S]*'serial', active_workorder\.serial,[\s\S]*'status', active_workorder\.status/i);
});
