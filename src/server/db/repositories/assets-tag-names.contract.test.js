import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./assets.repo.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/083_samsara_asset_tag_names.sql", import.meta.url), "utf8");
const workorders = readFileSync(new URL("./operational-workorders.repo.js", import.meta.url), "utf8");

test("vehicle search and detail expose tag names without exposing raw provider data", () => {
  const readQueries = source.slice(0, source.indexOf("export async function updateVehicleLocation"));
  assert.match(readQueries, /a\.tag_names/);
  assert.doesNotMatch(readQueries, /raw_provider_data/i);
  assert.match(readQueries, /a\.company_id = any\(\$5::uuid\[\]\)/);
  assert.match(readQueries, /a\.id = \$1 and a\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(workorders, /'tagNames', \$\{alias\}\.tag_names/);
});

test("Samsara upserts persist tag names as JSONB", () => {
  const upsert = source.slice(source.indexOf("export async function upsertVehicles"));
  assert.match(upsert, /tag_names/);
  assert.match(upsert, /tag_names = excluded\.tag_names/);
  assert.match(upsert, /JSON\.stringify\(vehicle\.tagNames \|\| \[\]\)/);
});

test("tag-name migration is metadata-safe and does not rewrite cached assets at startup", () => {
  assert.match(migration, /add column if not exists tag_names jsonb not null default '\[\]'::jsonb/i);
  assert.match(migration, /assets_tag_names_array_check/i);
  assert.match(migration, /check \(jsonb_typeof\(tag_names\) = 'array'\) not valid/i);
  assert.doesNotMatch(migration, /\bupdate\s+assets\b/i);
  assert.doesNotMatch(migration, /raw_provider_data\s*->\s*'tags'/i);
});
