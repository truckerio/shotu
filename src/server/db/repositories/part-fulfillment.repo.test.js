import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./part-fulfillment.repo.js", import.meta.url), "utf8");

test("fulfillment lookup partitions unrestricted location access by admin company", () => {
  assert.match(source, /request\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(source, /request\.company_id = any\(\$4::uuid\[\]\) or request\.destination_location_id = any\(\$3::uuid\[\]\)/);
  assert.match(source, /\[fulfillmentId, companyIds, locationIds, adminCompanyIds\]/);
  assert.doesNotMatch(source, /\$4::boolean or request\.destination_location_id/);
});
