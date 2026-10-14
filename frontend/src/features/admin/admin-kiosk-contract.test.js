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
  const users = await readFile(new URL("./workspace/UsersPage.jsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("./workspace/AdminUserActionDialog.jsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("./AdminWorkspace.jsx", import.meta.url), "utf8");
  const model = await readFile(new URL("./workspace/admin-workspace-model.js", import.meta.url), "utf8");

  assert.match(users, /user\.role === "mechanic"/);
  assert.match(users, /user\.kiosk_pin_set/);
  assert.match(users, /user\.kiosk_pin_requires_change/);
  assert.match(users, /onManage\("kiosk-pin", user\)/);
  assert.match(users, /user\.role === "mechanic" \? <Lock01 \/> : <Mail01 \/>/);
  assert.match(users, /textValue=\{user\.kiosk_pin_set \? "Reset kiosk PIN" : "Set kiosk PIN"\}[\s\S]*?<Passcode \/>/);
  assert.match(workspace, /await api\(`\$\{base\}\/kiosk-pin`/);
  assert.match(workspace, /JSON\.stringify\(\{ pin: kioskPinDraft\.pin \}\)/);
  assert.match(model, /DEFAULT_TEMPORARY_KIOSK_PIN = "0000"/);
  assert.match(workspace, /useState\(BLANK_KIOSK_PIN\)/);
  assert.match(dialog, /minLength="4"/);
  assert.match(dialog, /pattern="\[0-9\]\{4,\}"/);
  assert.match(dialog, /admin-kiosk-pin-error/);
  assert.doesNotMatch(dialog, /ValidationRequirements/);
  assert.match(dialog, /setKioskPinError\(""\)/);
});

test("Admin kiosk panel manages devices only", async () => {
  const source = await readFile(featureUrl, "utf8");

  assert.doesNotMatch(source, /kiosk-pin/);
  assert.doesNotMatch(source, /Mechanic kiosk PIN/);
  assert.doesNotMatch(source, /users\s*=/);
  assert.match(source, /useClientCheckpointPages\(devices, \{ pageSize: 10, resetKey: locationId \}\)/);
  assert.match(source, /<CheckpointCollection[\s\S]*queue=\{\{ \.\.\.queue, loading: state\.loading \}\}[\s\S]*className="admin-kiosk-device-list"/);
  assert.match(source, /<article \{\.\.\.rowProps\} className="admin-kiosk-device"/);
  assert.doesNotMatch(source, /<Pagination/);
});

test("Admin location detail owns kiosk setup without adding global navigation", async () => {
  const locations = await readFile(new URL("./workspace/LocationsPage.jsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("./adminNavigation.js", import.meta.url), "utf8");
  const css = await readFile(new URL("./kiosk-settings.css", import.meta.url), "utf8");

  assert.match(locations, /tab === "kiosk"/);
  assert.match(locations, /<KioskSettingsPanel locationId=\{detail\.location\.id\} \/>/);
  assert.doesNotMatch(navigation, /view:\s*"kiosk"/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
  assert.match(css, /\.admin-kiosk-register\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
