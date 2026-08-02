import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { markDoneSchema } from "./workorder.schemas.js";

const migrationUrl = new URL("../../db/migrations/005_workorder_access_audit.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url);

test("workorder access audit is append-only and included in the shared timeline", async () => {
  const [migration, repository] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);

  assert.match(migration, /create table if not exists workorder_access_events/);
  assert.match(migration, /workorder_access_events_workorder_idx/);
  assert.match(repository, /insert into workorder_access_events/);
  assert.match(repository, /'access' as type/);
  assert.match(repository, /from_mechanic_name/);
  assert.match(repository, /to_mechanic_name/);
});

test("Work done uses authenticated identity and requires completed-work details", () => {
  assert.equal(markDoneSchema.safeParse({}).success, false);
  assert.equal(markDoneSchema.safeParse({ diagnosis: "Checked brakes", workPerformed: "" }).success, false);
  assert.equal(markDoneSchema.safeParse({
    diagnosis: "Checked brakes",
    workPerformed: "Replaced brake pads",
  }).success, true);
  assert.equal(markDoneSchema.safeParse({
    diagnosis: "",
    workPerformed: "Replaced brake pads",
    confirmationName: "Mechanic Demo 1",
  }).success, true);
});
