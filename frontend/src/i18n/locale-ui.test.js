import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const hook = readSource("../hooks/useWorkorderPreferences.js");
const home = readSource("../features/mechanic/MechanicWorkspace.jsx");
const detail = readSource("../features/workorder-detail/WorkorderDetailPage.jsx");
const detailSurface = readSource("../components/workorders/WorkorderDetailSurface.jsx");

test("authenticated locale updates use a narrow preference patch and recover on failure", () => {
  assert.match(hook, /JSON\.stringify\(\{ locale \}\)/);
  assert.match(hook, /setPreferences\(restored\)/);
  assert.match(hook, /\.\.\.latest\.current,\s*locale:/s);
  assert.match(hook, /locale: "en"/);
  assert.match(hook, /JSON\.stringify\(\{ defaultLocationId, defaultView, savedFilters \}\)/);
});

test("mechanic home and detail share the locale selector and static dictionary owner", () => {
  assert.match(home, /<LocaleSelector/);
  assert.match(home, /interfaceText\(locale, key\)/);
  assert.match(detail, /<LocaleSelector/);
  assert.match(detail, /localizedMechanicHelpActions\(locale\)/);
  assert.match(detail, /interfaceText\(locale, "mechanic\.myWork"\)/);
  assert.match(detail, /activeWorkorder\.workorder\.serial \|\| t\("detail\.workorder"\)/);
  assert.match(detailSurface, /ariaLabel=\{interfaceText\(locale, "detail\.breadcrumb"\)\}/);
});

test("dynamic workorder content bypasses interface translation", () => {
  assert.match(home, /\{nextJob\.concern \|\|/);
  assert.doesNotMatch(home, /interfaceText\(locale, nextJob/);
  assert.doesNotMatch(detail, /interfaceText\(locale, form/);
});
