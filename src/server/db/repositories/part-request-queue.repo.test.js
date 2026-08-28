import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { queueResultFromQueryRows } from "./part-request-queue.repo.js";

const source = await readFile(new URL("./part-request-queue.repo.js", import.meta.url), "utf8");

test("unresolved request queue keeps its tenant, location, lifecycle, supply, and total contracts in one query", () => {
  assert.match(source, /wo\.company_id = any\(\$1::uuid\[\]\)/);
  assert.match(source, /\(\$3::boolean or wo\.location_id = any\(\$2::uuid\[\]\)\)/);
  assert.match(source, /wo\.status <> 'cancelled'/);
  assert.match(source, /pr\.approval_status in \('submitted', 'needs_info'\)/);
  assert.match(source, /pr\.approval_status = 'approved'/);
  assert.match(source, /allocation\.status in \('issued', 'installed'\)/);
  assert.doesNotMatch(source, /usage_status not in \('issued', 'installed'\)/);
  assert.doesNotMatch(source, /item\.source_provider = 'local'/);
  assert.match(source, /item\.company_id = wo\.company_id/);
  assert.match(source, /allocation\.part_request_id = pr\.id/);
  assert.doesNotMatch(source, /part_fulfillment_requests/);
  assert.match(source, /filtered_requests/);
  assert.match(source, /paged_requests as/);
  assert.match(source, /\(select count\(\*\)::int from filtered_requests\) as total_count/);
  assert.match(source, /jsonb_agg\([\s\S]*to_jsonb\(paged_requests\)[\s\S]*order by[\s\S]*\$10 = 'waiting:desc'[\s\S]*\$10 = 'activity:desc'[\s\S]*\$10 = 'activity:asc'[\s\S]*\$10 = 'created:desc'[\s\S]*id[\s\S]*\)/);
  assert.match(source, /\$7 = '' or concat_ws/);
  assert.match(source, /\$8 = ''/);
  assert.match(source, /\$9 = ''/);
  assert.match(source, /\$10 = 'waiting:desc'/);
  assert.match(source, /\$9 = 'available' and not has_ordered/);
  assert.match(source, /\$9 = 'partial' and not has_ordered/);
});

test("queue response preserves the filtered total when the requested page has no rows", () => {
  assert.deepEqual(queueResultFromQueryRows([{ total_count: 17, items: [] }]), {
    items: [],
    total: 17,
  });
});

test("ordered supply takes precedence over availability in the queue status", () => {
  const orderedIndex = source.indexOf("when has_ordered then 'ordered'");
  const availableIndex = source.indexOf("then 'available'");
  assert.ok(orderedIndex >= 0);
  assert.ok(availableIndex >= 0);
  assert.ok(orderedIndex < availableIndex);
});
