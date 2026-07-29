import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const featureUrl = new URL("./KioskSettingsPanel.jsx", import.meta.url);

test("Admin kiosk panel uses approved device API contracts", async () => {
  const source = await readFile(featureUrl, "utf8");

  assert.match(source, /\/api\/admin\/locations\/\$\{encodeURIComponent\(locationId\)\}\/kiosk-devices`/);
  assert.match(source, /\/kiosk-devices\/register`/);
  assert.match(source, /JSON\.stringify\(\{ name: deviceName\.trim\(\) \}\)/);
  assert.match(source, /\/kiosk-devices\/\$\{encodeURIComponent\(device\.id\)\}\/revoke`/);
});

test("Admin kiosk panel issues temporary mechanic PIN through location-scoped endpoint", async () => {
  const source = await readFile(featureUrl, "utf8");

  assert.match(source, /user\.role === "mechanic"/);
  assert.match(source, /user\.active/);
  assert.match(source, /user\.membership_active/);
  assert.match(source, /\/users\/\$\{encodeURIComponent\(selectedMechanicId\)\}\/kiosk-pin`/);
  assert.match(source, /JSON\.stringify\(\{ pin \}\)/);
  assert.match(source, /Temporary PIN/);
  assert.match(source, /DEFAULT_TEMPORARY_KIOSK_PIN = "0000"/);
  assert.match(source, /useState\(DEFAULT_TEMPORARY_KIOSK_PIN\)/);
  assert.match(source, /minLength="4"/);
  assert.match(source, /pattern="\[0-9\]\{4,\}"/);
  assert.match(source, /admin-kiosk-pin-error/);
  assert.doesNotMatch(source, /ValidationRequirements/);
  assert.match(source, /setPinError\(""\)/);
});

test("Admin location detail owns kiosk setup without adding global navigation", async () => {
  const workspace = await readFile(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("./adminNavigation.js", import.meta.url), "utf8");
  const css = await readFile(new URL("./kiosk-settings.css", import.meta.url), "utf8");

  assert.match(workspace, /tab === "kiosk"/);
  assert.match(workspace, /<KioskSettingsPanel locationId=\{detail\.location\.id\} users=\{detail\.users\}/);
  assert.doesNotMatch(navigation, /view:\s*"kiosk"/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
  assert.match(css, /\.admin-kiosk-register,[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
