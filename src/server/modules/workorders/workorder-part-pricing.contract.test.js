import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workorder price selection is office/admin only and never substitutes average cost", async () => {
  const service = await readFile(new URL("./workorder-part-pricing.service.js", import.meta.url), "utf8");
  const repository = await readFile(new URL("../../db/repositories/workorder-part-pricing.repo.js", import.meta.url), "utf8");
  assert.match(service, /\["office",\s*"admin"\]\.includes\(context\.actor\.role\)/);
  assert.match(service, /Exact batch cost is unavailable/);
  assert.match(repository, /line\.unit_cost/);
  assert.doesNotMatch(repository, /avg\s*\(|latest purchase|order by[^;]*receipt.*desc/i);
});

test("workorder projection removes financial snapshots for mechanic viewers", async () => {
  const projection = await readFile(new URL("./workorder-module-projection.js", import.meta.url), "utf8");
  assert.match(projection, /\["office",\s*"admin"\]\.includes\(viewerRole\)/);
  assert.match(projection, /price: _price, costAllocations: _costAllocations/);
});
