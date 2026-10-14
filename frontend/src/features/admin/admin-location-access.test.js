import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");
const locationDialogs = readFileSync(new URL("./workspace/AdminLocationDialogs.jsx", import.meta.url), "utf8");
const userDialog = readFileSync(new URL("./workspace/AdminUserActionDialog.jsx", import.meta.url), "utf8");
const model = readFileSync(new URL("./workspace/admin-workspace-model.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");

test("shared location selector supports invite and existing-user access", () => {
  assert.match(locationDialogs, /function LocationSelector/);
  assert.match(locationDialogs, /<LocationSelector locations=\{companyLocations\} value=\{inviteLocationIds\}[^>]*requiredIds=\{selectedId \? \[selectedId\] : \[\]\}/);
  assert.match(userDialog, /<LocationSelector locations=\{companyLocations\} value=\{userLocationDraft\}/);
});

test("invites include all selected locations and retain the current location", () => {
  assert.match(workspace, /setInviteLocationIds\(selectedId \? \[selectedId\] : \[\]\)/);
  assert.match(workspace, /new Set\(\[selectedId, \.\.\.inviteLocationIds\]/);
  assert.match(workspace, /JSON\.stringify\(\{ \.\.\.inviteDraft, locationIds \}\)/);
});

test("existing-user access uses the company-scoped location endpoint", () => {
  assert.match(workspace, /`\/api\/admin\/users\/\$\{userAction\.user\.id\}\/locations`/);
  assert.match(workspace, /JSON\.stringify\(\{ companyId: selectedCompanyId, locationIds: userLocationDraft \}\)/);
  assert.match(workspace, /setUserLocationDraft\(userLocationIds\(user, selectedId\)\)/);
  assert.match(model, /user\.locationIds \|\| user\.location_ids/);
});

test("selectors only expose locations from the selected company", () => {
  assert.match(workspace, /selectedCompanyId = detail\?\.location\?\.company_id/);
  assert.match(workspace, /locations\.filter\(\(location\) => \(location\.company_id \|\| location\.companyId\) === selectedCompanyId\)/);
});

test("admin access is inherited and not editable", () => {
  assert.match(userDialog, /userAction\.user\.role === "admin"/);
  assert.match(userDialog, /Admins automatically inherit access to every current and future location/);
});

test("admin invitations use inherited company-wide access", () => {
  assert.match(locationDialogs, /<option value="admin">Admin<\/option>/);
  assert.match(locationDialogs, /inviteDraft\.role === "admin"/);
  assert.match(locationDialogs, /inviteDraft\.role !== "admin" && !inviteLocationIds\.length/);
});

test("location selector remains contained on mobile", () => {
  assert.match(css, /\.admin-location-selector \{[^}]*min-width: 0;/s);
  assert.match(css, /\.admin-location-options \{[^}]*max-height: 220px;[^}]*overflow-y: auto;/s);
});
