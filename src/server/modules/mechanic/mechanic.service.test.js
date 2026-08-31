import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mechanicAllowedActions } from "./mechanic.service.js";

const mechanicId = "mechanic-1";

test("Mechanic Parts mutations retain an explicit active Mechanic owner guard", async () => {
  const source = await readFile(new URL("./mechanic.service.js", import.meta.url), "utf8");
  const guard = source.slice(source.indexOf("async function requireMechanic"), source.indexOf("export async function defaultMechanicUser"));

  assert.match(guard, /user\.active/);
  assert.match(guard, /user\.role !== "mechanic"/);
});

test("legacy mechanic part usage is denied at the service boundary before repository dispatch", async () => {
  const source = await readFile(new URL("./mechanic.service.js", import.meta.url), "utf8");
  const usage = source.slice(source.indexOf("export async function updateMechanicPartUsage"), source.indexOf("export async function acceptMechanicWorkorder"));

  assert.match(usage, /MECHANIC_PART_USAGE_READ_ONLY/);
  assert.doesNotMatch(usage, /updatePartUsage\(/);
});

test("assigned mechanic chat stays available after repair editing locks", () => {
  for (const status of ["mechanic_done", "closed", "odoo_entered"]) {
    const actions = mechanicAllowedActions({ status, mechanicIds: [mechanicId] }, mechanicId);
    assert.equal(actions.sendMessage, true, `${status} should keep chat available`);
    assert.equal(actions.saveNotes, false);
    assert.equal(actions.requestParts, false);
    assert.equal(actions.markDone, false);
  }
});

test("unassigned mechanic cannot chat on another mechanic's workorder", () => {
  const actions = mechanicAllowedActions(
    { status: "in_progress", mechanicIds: ["mechanic-2"] },
    mechanicId,
  );
  assert.equal(actions.sendMessage, false);
  assert.equal(actions.saveNotes, false);
});

test("active assigned work keeps chat and repair actions available", () => {
  const actions = mechanicAllowedActions(
    { status: "in_progress", mechanicIds: [mechanicId] },
    mechanicId,
  );
  assert.equal(actions.sendMessage, true);
  assert.equal(actions.saveNotes, true);
  assert.equal(actions.requestParts, true);
  assert.equal(actions.markDone, true);
});
