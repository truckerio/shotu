import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("../../db/repositories/locations.repo.js", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../../../frontend/src/features/admin/workspace/LocationsPage.jsx", import.meta.url),
  "utf8",
);
const usersPage = readFileSync(
  new URL("../../../../frontend/src/features/admin/workspace/UsersPage.jsx", import.meta.url),
  "utf8",
);
const countsQuery = repository.slice(
  repository.indexOf("export async function listLocationsWithAdminCounts"),
  repository.indexOf("export async function createLocationWithTemplate"),
);

test("admin location counts expose explicit assigned-active semantics with a compatibility alias", () => {
  assert.match(countsQuery, /as assigned_active_user_count/i);
  assert.match(countsQuery, /as user_count/i);
  assert.match(countsQuery, /where location_membership\.active/i);
});

test("assigned-active counts exclude inactive companies, users, and deleted profiles", () => {
  assert.match(countsQuery, /company_membership\.active/i);
  assert.match(countsQuery, /profile\.active/i);
  assert.match(countsQuery, /profile\.deleted_at is null/i);
});

test("location cards label active explicit assignments without breaking older API responses", () => {
  assert.match(workspace, /Assigned active/);
  assert.match(workspace, /location\.assigned_active_user_count \?\? location\.user_count \?\? 0/);
  assert.doesNotMatch(workspace, /<small>Users<\/small><strong>\{location\.user_count\}/);
});

test("location detail separates user populations instead of showing an ambiguous total", () => {
  assert.match(usersPage, /title="Company-wide admins"/);
  assert.match(usersPage, /title="Assigned active"/);
  assert.match(usersPage, /title="Inactive"/);
  assert.match(usersPage, /Pending invitations/);
  assert.doesNotMatch(usersPage, /<Users01 \/> Users <span>\{detail\.users\.length\}<\/span>/);
});
