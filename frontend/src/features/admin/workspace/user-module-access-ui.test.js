import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const usersPageUrl = new URL("./UsersPage.jsx", import.meta.url);
const dialogUrl = new URL("./AdminUserActionDialog.jsx", import.meta.url);
const controlsUrl = new URL("./WorkorderModuleAccessControls.jsx", import.meta.url);
const templateUrl = new URL("./TemplatePage.jsx", import.meta.url);
const workspaceUrl = new URL("../AdminWorkspace.jsx", import.meta.url);

async function read(url) {
  return readFile(url, "utf8");
}

test("users table exposes per-user module access from the user action menu", async () => {
  const usersPage = await read(usersPageUrl);
  assert.match(usersPage, /onManage\("modules", user\)/);
  assert.match(usersPage, /Module access for \$\{user\.name\}/);
  assert.match(usersPage, /textValue="Module access"/);
});

test("user module action is an intentional shortcut to the single Modules page", async () => {
  const dialog = await read(dialogUrl);
  const workspace = await read(workspaceUrl);
  assert.doesNotMatch(dialog, /UserModuleAccessEditor/);
  assert.match(workspace, /if \(type === "modules"\)/);
  assert.match(workspace, /openLocation\(selectedId, "work", "modules"\)/);
  assert.doesNotMatch(workspace, /nextUserModuleAccess/);
});

test("location Rules links to Modules instead of keeping a second role editor", async () => {
  const controls = await read(controlsUrl);
  const template = await read(templateUrl);
  assert.match(controls, /export function RoleModuleAccessTable/);
  assert.match(controls, /export function UserModuleAccessEditor/);
  assert.doesNotMatch(template, /<RoleModuleAccessTable/);
  assert.match(template, /Open Modules/);
  assert.match(template, /single Modules page/);
});
