import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");

test("shared location selector supports invite and existing-user access", () => {
  assert.match(workspace, /function LocationSelector/);
  assert.match(workspace, /<LocationSelector locations=\{companyLocations\} value=\{inviteLocationIds\}[^>]*requiredIds=\{selectedId \? \[selectedId\] : \[\]\}/);
  assert.match(workspace, /<LocationSelector locations=\{companyLocations\} value=\{userLocationDraft\}/);
});

test("invites include all selected locations and retain the current location", () => {
  assert.match(workspace, /setInviteLocationIds\(selectedId \? \[selectedId\] : \[\]\)/);
  assert.match(workspace, /new Set\(\[selectedId, \.\.\.inviteLocationIds\]/);
  assert.match(workspace, /JSON\.stringify\(\{ \.\.\.inviteDraft, locationIds \}\)/);
});

test("existing-user access uses the company-scoped location endpoint", () => {
  assert.match(workspace, /`\/api\/admin\/users\/\$\{userAction\.user\.id\}\/locations`/);
  assert.match(workspace, /JSON\.stringify\(\{ companyId: selectedCompanyId, locationIds: userLocationDraft \}\)/);
  assert.match(workspace, /user\.locationIds \|\| user\.location_ids/);
});

test("selectors only expose locations from the selected company", () => {
  assert.match(workspace, /selectedCompanyId = detail\?\.location\?\.company_id/);
  assert.match(workspace, /locations\.filter\(\(location\) => \(location\.company_id \|\| location\.companyId\) === selectedCompanyId\)/);
});

test("admin access is inherited and not editable", () => {
  assert.match(workspace, /userAction\.user\.role === "admin"/);
  assert.match(workspace, /Admins automatically inherit access to every current and future location/);
});

test("admin invitations use inherited company-wide access", () => {
  assert.match(workspace, /<option value="admin">Admin<\/option>/);
  assert.match(workspace, /inviteDraft\.role === "admin"/);
  assert.match(workspace, /inviteDraft\.role !== "admin" && !inviteLocationIds\.length/);
});

test("location selector remains contained on mobile", () => {
  assert.match(css, /\.admin-location-selector \{[^}]*min-width: 0;/s);
  assert.match(css, /\.admin-location-options \{[^}]*max-height: 220px;[^}]*overflow-y: auto;/s);
});
