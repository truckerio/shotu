import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readInventoryAuthorityException,
  readInventoryAuthorityExceptions,
  resolveInventoryAuthorityException,
} from "./inventory-authority-reconciliation.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const EXCEPTION_ID = "00000000-0000-4000-8000-000000000004";
const context = (role = "admin") => ({
  actor: { id: ACTOR_ID, role },
  companyIds: new Set([COMPANY_ID]),
  locationIds: new Set([LOCATION_ID]),
});

test("authority queue is Admin-only and bounded", async () => {
  let called = false;
  await assert.rejects(
    readInventoryAuthorityExceptions(new URLSearchParams(), context("office"), {
      listAuthorityExceptions: async () => { called = true; },
    }),
    (error) => error.code === "INVENTORY_AUTHORITY_ADMIN_REQUIRED" && error.statusCode === 403,
  );
  assert.equal(called, false);
  let query;
  const result = await readInventoryAuthorityExceptions(new URLSearchParams("page=2&limit=100"), context(), {
    listAuthorityExceptions: async (input) => { query = input; return { items: [], total: 120 }; },
  });
  assert.deepEqual(result, { items: [], total: 120, page: 2, limit: 100 });
  assert.equal(query.offset, 100);
  await assert.rejects(readInventoryAuthorityExceptions(new URLSearchParams("limit=101"), context()));
});

test("cross-tenant detail stays behind indistinguishable inventory not-found", async () => {
  await assert.rejects(
    readInventoryAuthorityException(EXCEPTION_ID, context(), { getAuthorityException: async () => null }),
    (error) => error.code === "inventory_not_found" && error.statusCode === 404,
  );
});

test("acknowledgement is strict, idempotent, and never bypasses reservations", async () => {
  await assert.rejects(
    resolveInventoryAuthorityException(EXCEPTION_ID, {
      action: "acknowledge", reason: "Reviewed evidence", idempotencyKey: "authority-ack-1", unexpected: true,
    }, context(), { acknowledgeAuthorityException: async () => assert.fail("invalid input reached repository") }),
  );
  await assert.rejects(
    resolveInventoryAuthorityException(EXCEPTION_ID, {
      action: "acknowledge", reason: "Reviewed evidence", idempotencyKey: "authority-ack-2",
    }, context(), { acknowledgeAuthorityException: async () => ({ kind: "reservation_blocked" }) }),
    (error) => error.code === "INVENTORY_AUTHORITY_RESERVATION_ACTIVE" && error.statusCode === 409,
  );
  const result = await resolveInventoryAuthorityException(EXCEPTION_ID, {
    action: "acknowledge", reason: "Provider evidence reviewed; physical intake remains required.",
    idempotencyKey: "authority-ack-3",
  }, context(), { acknowledgeAuthorityException: async () => ({ kind: "resolved", exceptionId: EXCEPTION_ID, outcome: "resolved_without_stock_mutation" }) });
  assert.deepEqual(result, { exceptionId: EXCEPTION_ID, outcome: "resolved_without_stock_mutation", replayed: false });
});

test("reconciliation repository mutates only exception state and append-only events", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-authority.repo.js", import.meta.url), "utf8");
  const action = source.slice(source.indexOf("export async function acknowledgeInventoryAuthorityException"), source.indexOf("export async function inspectInventoryAuthority"));
  assert.match(action, /quantity_reserved[\s\S]*reservation_blocked/);
  assert.match(action, /update inventory_authority_exceptions set resolved_at=now\(\)/);
  assert.match(action, /insert into inventory_authority_exception_events/);
  assert.doesNotMatch(action, /insert into inventory_(?:items|receipts|stock_movements)/);
  assert.doesNotMatch(action, /update inventory_items set/);
});
