import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mechanicAllowedActions } from "../mechanic/mechanic.service.js";
import { officeAllowedActions } from "../office/office.service.js";
import { cancelWorkorderSchema, returnWorkorderSchema } from "./workorder.schemas.js";

const migrationUrl = new URL("../../db/migrations/039_workorder_handoff.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url);

test("handoff mutation inputs require useful bounded reasons and known categories", () => {
  assert.equal(returnWorkorderSchema.safeParse({ reason: " " }).success, false);
  assert.equal(returnWorkorderSchema.safeParse({ reason: "x".repeat(1001) }).success, false);
  assert.equal(returnWorkorderSchema.safeParse({ reason: "Redo diagnosis", categories: ["diagnosis", "diagnosis"] }).data.categories.length, 1);
  assert.equal(returnWorkorderSchema.safeParse({ reason: "Redo", categories: ["unknown"] }).success, false);
  assert.equal(cancelWorkorderSchema.safeParse({ reason: " " }).success, false);
  assert.equal(cancelWorkorderSchema.safeParse({ reason: "Duplicate request" }).success, true);
});

test("Manager actions reflect active, review, correction, and terminal lifecycles", () => {
  assert.deepEqual(officeAllowedActions("in_progress"), {
    update: true,
    updateAdministrative: true,
    saveNotes: true,
    recordUsedParts: true,
    addApprovedParts: true,
    approve: false,
    returnToMechanic: false,
    cancel: true,
    assignMechanics: true,
  });
  assert.equal(officeAllowedActions("mechanic_done").approve, true);
  assert.equal(officeAllowedActions("mechanic_done").addApprovedParts, false);
  assert.equal(officeAllowedActions("mechanic_done").returnToMechanic, true);
  assert.equal(officeAllowedActions("closed").updateAdministrative, false);
  assert.equal(officeAllowedActions("closed").recordUsedParts, false);
  assert.equal(officeAllowedActions("closed", [{ reason: "missing_info" }]).updateAdministrative, true);
  assert.equal(officeAllowedActions("closed", [{ reason: "missing_info" }]).recordUsedParts, true);
  assert.equal(officeAllowedActions("odoo_entered").cancel, false);
  assert.equal(officeAllowedActions("cancelled").update, false);
});

test("cancelled work locks every mechanic repair action while retaining participant chat", () => {
  const actions = mechanicAllowedActions({ status: "cancelled", mechanicIds: ["mechanic-1"] }, "mechanic-1", {
    mechanicCanRecordParts: true,
  });
  assert.equal(actions.sendMessage, true);
  assert.equal(actions.saveNotes, false);
  assert.equal(actions.recordUsedParts, false);
  assert.equal(actions.release, false);
  assert.equal(actions.markDone, false);
  assert.equal(actions.requestParts, false);
});

test("handoff migration and repository encode transactional lifecycle ownership", async () => {
  const [migration, repository] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  for (const column of ["cancelled_at", "cancelled_by_user_id", "cancel_reason", "approved_by_user_id"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /revision_requested/);
  assert.match(repository, /for update/);
  assert.match(repository, /started_at = coalesce\(started_at, now\(\)\)/);
  assert.match(repository, /mechanic_done_at = null/);
  assert.match(repository, /quantity_reserved = quantity_reserved - \$2/);
  assert.match(repository, /approved_by_user_id = \$3/);
});
