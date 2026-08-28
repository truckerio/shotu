import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { interfaceText, missingLocaleKeys } from "../../i18n/index.js";

const router = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const outlet = readFileSync(new URL("../../app/routes/RoleWorkspaceOutlet.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./CreateWorkorderPage.jsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./CreateWorkorderShell.jsx", import.meta.url), "utf8");

test("mechanic locale reaches Create route, page, shell, navigation, dates, and preview surfaces", () => {
  assert.match(router, /locale: actor\.role === "mechanic" \? interfaceLocale : "en"/);
  assert.match(page, /locale = "en"/);
  assert.match(page, /locale=\{locale\}/);
  assert.match(page, /create\.section\.\$\{section\.id\}/);
  assert.match(shell, /formatUiDateRange\([\s\S]*\{ locale \}\)/);
  assert.equal((shell.match(/locale=\{locale\}/g) || []).length, 3);
});

test("Create route and shell static states use the shared interface dictionary", () => {
  assert.match(outlet, /create\.openingWorkorder/);
  assert.match(outlet, /create\.routeUnavailableMessage/);
  assert.match(page, /create\.noWritableModules/);
  assert.match(page, /create\.fixHighlightedFields/);
  assert.match(page, /create\.failed/);
  assert.match(shell, /create\.creating/);
  assert.match(shell, /create\.openPreview/);
  assert.doesNotMatch(shell, />Create workorder</);
  assert.doesNotMatch(outlet, />Opening workorder\.\.\.</);
});

test("Create keys have Spanish and Punjabi translations without affecting user content", () => {
  assert.equal(missingLocaleKeys("es").length, 0);
  assert.equal(missingLocaleKeys("pa").length, 0);
  assert.equal(interfaceText("es", "create.title"), "Crear orden de trabajo");
  assert.equal(interfaceText("pa", "create.title"), "ਵਰਕਆਰਡਰ ਬਣਾਓ");
  assert.match(shell, /form\.mechanicConcern/);
  assert.match(shell, /form\.customerCompanyName/);
});
