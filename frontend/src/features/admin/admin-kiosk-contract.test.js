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

test("Admin users own temporary mechanic PIN management and status", async () => {
  const source = await readFile(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");

  assert.match(source, /user\.role === "mechanic"/);
  assert.match(source, /user\.kiosk_pin_set/);
  assert.match(source, /user\.kiosk_pin_requires_change/);
  assert.match(source, /onManage\("kiosk-pin", user\)/);
  assert.match(source, /user\.role === "mechanic" \? <Lock01 \/> : <Mail01 \/>/);
  assert.match(source, /textValue=\{user\.kiosk_pin_set \? "Reset kiosk PIN" : "Set kiosk PIN"\}[\s\S]*?<Passcode \/>/);
  assert.match(source, /await api\(`\$\{base\}\/kiosk-pin`/);
  assert.match(source, /JSON\.stringify\(\{ pin: kioskPinDraft\.pin \}\)/);
  assert.match(source, /DEFAULT_TEMPORARY_KIOSK_PIN = "0000"/);
  assert.match(source, /useState\(blankKioskPin\)/);
  assert.match(source, /minLength="4"/);
  assert.match(source, /pattern="\[0-9\]\{4,\}"/);
  assert.match(source, /admin-kiosk-pin-error/);
  assert.doesNotMatch(source, /ValidationRequirements/);
  assert.match(source, /setKioskPinError\(""\)/);
});

test("Admin kiosk panel manages devices only", async () => {
  const source = await readFile(featureUrl, "utf8");

  assert.doesNotMatch(source, /kiosk-pin/);
  assert.doesNotMatch(source, /Mechanic kiosk PIN/);
  assert.doesNotMatch(source, /users\s*=/);
});

test("Admin location detail owns kiosk setup without adding global navigation", async () => {
  const workspace = await readFile(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("./adminNavigation.js", import.meta.url), "utf8");
  const css = await readFile(new URL("./kiosk-settings.css", import.meta.url), "utf8");

  assert.match(workspace, /tab === "kiosk"/);
  assert.match(workspace, /<KioskSettingsPanel locationId=\{detail\.location\.id\} \/>/);
  assert.doesNotMatch(navigation, /view:\s*"kiosk"/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
  assert.match(css, /\.admin-kiosk-register\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
