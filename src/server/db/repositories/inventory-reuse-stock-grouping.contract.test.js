import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("custody stock groups receipt snapshots by current catalog identity", async () => {
  const source = await readFile(new URL("./inventory-reuse.repo.js", import.meta.url), "utf8");

  // One catalog part can have receipt lines captured under both an old and a
  // current display name. The stock collection must still emit one row/key.
  assert.match(source, /join parts_catalog p on p\.company_id=u\.company_id and p\.id=l\.catalog_part_id/);
  assert.match(source, /select count\([^)]*distinct p\.id[^)]*\)::int as total/);
  assert.match(source, /select p\.id as catalog_part_id,p\.part_number,p\.description/);
  assert.match(source, /group by p\.id order by p\.id/);
  assert.match(source, /const identity = input\.view === "units" \? "l" : "p"/);
  assert.doesNotMatch(source, /group by l\.catalog_part_id,l\.part_number,l\.description/);
});
