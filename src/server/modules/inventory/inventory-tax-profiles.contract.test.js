import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("migration 135 keeps profile lineage tenant-bound, versions immutable and legacy prices explicit", async () => {
  const sql = await readFile(new URL("../../db/migrations/135_inventory_tax_profiles_and_price_treatment.sql", import.meta.url), "utf8");
  assert.match(sql, /foreign key \(company_id, id, current_version_id\)/i);
  assert.match(sql, /references inventory_tax_profile_versions\(company_id, profile_id, id\)/i);
  assert.match(sql, /foreign key \(company_id, profile_id, previous_version_id\)/i);
  assert.match(sql, /inventory_tax_profile_versions_immutable/i);
  assert.match(sql, /tax_treatment varchar\(24\) not null default 'legacy_unknown'/i);
  assert.match(sql, /where amount is null/i);
  assert.match(sql, /for share of profile, version/i);
});
