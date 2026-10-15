import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mileage migration keeps observations and commands append-only and tenant scoped", async () => {
  const sql = await readFile(new URL("./199_asset_mileage_observations.sql", import.meta.url), "utf8");
  assert.match(sql, /foreign key\(company_id,asset_id\) references assets\(company_id,id\)/i);
  assert.match(sql, /asset_mileage_observations_append_only/i);
  assert.match(sql, /asset_mileage_commands_append_only/i);
  assert.match(sql, /source in \('samsara_obd','samsara_gps','manual'\)/i);
  assert.doesNotMatch(sql, /update\s+inspections/i);
});
