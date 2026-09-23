import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql=await readFile(new URL("../../db/migrations/134_inventory_physical_positions.sql",import.meta.url),"utf8");
const identitySql=await readFile(new URL("../../db/migrations/163_inventory_position_count_identities.sql",import.meta.url),"utf8");
const submissionSql=await readFile(new URL("../../db/migrations/172_inventory_position_count_submission.sql",import.meta.url),"utf8");

test("physical positions keep hierarchy, usage, accounting and exact placement separate",()=>{
  assert.match(sql,/create table inventory_positions/i);
  assert.match(sql,/parent_id uuid/i);
  assert.match(sql,/kind in \('warehouse','zone','aisle','rack','shelf','bin','room','area'\)/i);
  assert.match(sql,/create table inventory_position_balances/i);
  assert.match(sql,/add column current_position_id uuid/i);
  assert.match(sql,/create table inventory_position_movements/i);
});

test("migration gates ambiguous legacy reservations and never copies text bins",()=>{
  assert.match(sql,/active_legacy_allocation/i);
  assert.match(sql,/aggregate_balance_ambiguous/i);
  assert.doesNotMatch(sql,/reviewed_bin_location|bin_location.*inventory_position/i);
  assert.doesNotMatch(sql,/greatest\s*\(/i);
});

test("hierarchy and archive have database guards",()=>{
  assert.match(sql,/inventory_position_tree_guard/i);
  assert.match(sql,/hierarchy cannot contain a cycle/i);
  assert.match(sql,/inventory_position_archive_guard/i);
  assert.match(sql,/still has active children or stock/i);
  assert.match(sql,/inventory_position_count_sessions[\s\S]*status='open'/i);
});

test("aggregate allocations bind the exact inventory item and recounts have explicit lineage",()=>{
  assert.match(sql,/inventory_aggregate_usage_position_allocations[\s\S]*inventory_item_id uuid not null/i);
  assert.match(sql,/superseded_by_session_id uuid/i);
  assert.match(sql,/needs_recount','superseded/i);
});

test("serialized counts persist identity, custody, and actor evidence",()=>{
  assert.match(identitySql,/create table if not exists inventory_position_count_unit_snapshots/i);
  assert.match(identitySql,/custody_version_snapshot integer not null/i);
  assert.match(identitySql,/unit_updated_at_snapshot timestamptz not null/i);
  assert.match(identitySql,/observed_by uuid references user_profiles/i);
  assert.match(identitySql,/input_mode varchar\(16\)/i);
  assert.match(identitySql,/add column if not exists applied_by/i);
  assert.match(identitySql,/observe_identity/i);
});

test("count submission is observation-only and enforces one active exact-position session",()=>{
  assert.match(submissionSql,/submitted_by uuid references user_profiles/i);
  assert.match(submissionSql,/submitted_at timestamptz/i);
  assert.match(submissionSql,/action in \('observe','observe_identity','add_found','submit','apply'\)/i);
  assert.match(submissionSql,/where status in \('open','ready'\)/i);
  assert.match(submissionSql,/create unique index if not exists inventory_position_count_one_active_position_idx/i);
});
