import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("mechanic workspace passes locale through the complete account surface", () => {
  const mechanic = source("../../features/mechanic/MechanicWorkspace.jsx");
  const header = source("../layout/WorkspaceHeader.jsx");
  const createActions = source("../layout/WorkspaceCreateActions.jsx");
  const profile = source("./ProfileMenu.jsx");
  assert.match(mechanic, /<WorkspaceHeader[^>]*locale=\{locale\}/);
  assert.match(header, /<ProfileMenu[^>]*locale=\{locale\}/);
  assert.match(mechanic, /<WorkspaceCreateActions[\s\S]*?locale=\{locale\}/);
  assert.match(createActions, /<ProfileMenu[^>]*mobileAction[^>]*locale=\{locale\}/);
  assert.match(profile, /<ChangePasswordDialog[^>]*locale=\{locale\}/);
  assert.match(profile, /<PasskeyManager[^>]*locale=\{locale\}/);
});

test("account dialogs use dictionary text and locale-aware dates", () => {
  const password = source("./ChangePasswordDialog.jsx");
  const passkeys = source("./PasskeyManager.jsx");
  assert.match(password, /interfaceText\(locale, key\)/);
  assert.match(passkeys, /interfaceText\(locale, key\)/);
  assert.match(passkeys, /Intl\.DateTimeFormat\(intlLocale\(locale\)/);
  assert.doesNotMatch(password, />Change password</);
  assert.doesNotMatch(passkeys, />Remove this passkey\?</);
});
