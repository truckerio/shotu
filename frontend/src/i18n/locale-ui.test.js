import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const hook = readSource("../hooks/useWorkorderPreferences.js");
const home = readSource("../features/mechanic/MechanicWorkspace.jsx");
const detail = readSource("../features/workorder-detail/WorkorderDetailPage.jsx");
const router = readSource("../app/routes/RoleRouter.jsx");

test("authenticated locale updates use a narrow preference patch and recover on failure", () => {
  assert.match(hook, /JSON\.stringify\(\{ locale \}\)/);
  assert.match(hook, /setPreferences\(restored\)/);
  assert.match(hook, /\.\.\.latest\.current,\s*locale:/s);
  assert.match(hook, /locale: "en"/);
  assert.match(hook, /JSON\.stringify\(\{ defaultLocationId, defaultView, savedFilters \}\)/);
});

test("document locale effect does not return the locale string as a React cleanup", () => {
  assert.match(router, /useEffect\(\(\) => \{\s*setDocumentLocale\(/);
  assert.doesNotMatch(router, /useEffect\(\(\) => setDocumentLocale\(/);
});

test("mechanic profile owns the locale selector across workspace routes", () => {
  const profile = readSource("../components/account/ProfileMenu.jsx");
  const outlet = readSource("../app/routes/RoleWorkspaceOutlet.jsx");
  assert.match(profile, /actor\?\.role === "mechanic" && interfacePreferences/);
  assert.match(profile, /<LocaleSelector/);
  assert.match(outlet, /InterfacePreferencesContext.Provider value=\{props.interfacePreferences\}/);
  assert.doesNotMatch(home, /LocaleSelector/);
  assert.match(home, /interfaceText\(locale, key\)/);
  assert.doesNotMatch(detail, /LocaleSelector/);
  assert.match(detail, /localizedMechanicHelpActions\(locale\)/);
  assert.match(detail, /interfaceText\(locale, "mechanic\.myWork"\)/);
  assert.match(detail, /activeWorkorder\.workorder\.serial \|\| t\("detail\.workorder"\)/);
});

test("dynamic workorder content bypasses interface translation", () => {
  assert.match(home, /\{nextJob\.concern \|\|/);
  assert.doesNotMatch(home, /interfaceText\(locale, nextJob/);
  assert.doesNotMatch(detail, /interfaceText\(locale, form/);
});
