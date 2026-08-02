import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const featureRoot = new URL("./", import.meta.url);

test("AuthGate preserves standard login and adds registered kiosk bootstrap", async () => {
  const source = await readFile(new URL("../auth/AuthGate.jsx", featureRoot), "utf8");

  assert.match(source, /api\("\/api\/kiosk\/context"\)/);
  assert.match(source, /<LoginPage \/>/);
  assert.match(source, /<KioskGate/);
  assert.match(source, /body\.sessionMode === "kiosk"/);
  assert.match(source, /<KioskSessionProvider/);
});

test("kiosk unlock uses approved endpoint and minimal mechanic roster fields", async () => {
  const source = await readFile(new URL("./KioskGate.jsx", featureRoot), "utf8");

  assert.match(source, /api\("\/api\/auth\/kiosk\/unlock"/);
  assert.match(source, /mechanicId: mechanic\.id/);
  assert.match(source, /requiresPinChange \? \{ newPin \} : \{\}/);
  assert.match(source, /kioskMechanicsInDisplayOrder\(context\.mechanics\)\.map/);
  assert.match(source, /kioskMechanicIdentity\(mechanic\)/);
  assert.match(source, /interfaceText\(activeLocale,/);
  assert.match(source, /kioskStoredLocale/);
  assert.match(source, /saveKioskLocale/);
  assert.match(source, /mechanic\?\.locale \|\| deviceLocale/);
  assert.match(source, /<strong>\{mechanic\.name\}<\/strong>/);
  assert.doesNotMatch(source, /interfaceText\([^\n]*mechanic\.name/);
  assert.match(source, /minLength="4"/);
  assert.match(source, /pattern="\[0-9\]\{4,\}"/);
  assert.doesNotMatch(source, /type="password"/);
  assert.equal((source.match(/type="text"/g) || []).length, 3);
  assert.doesNotMatch(source, /six-digit PIN/);
});

test("kiosk session uses server mode, audits exit, signs out, and locks on inactivity", async () => {
  const source = await readFile(new URL("./KioskSessionContext.jsx", featureRoot), "utf8");

  assert.match(source, /sessionMode === "kiosk"/);
  assert.match(source, /api\("\/api\/kiosk\/event"/);
  assert.match(source, /JSON\.stringify\(\{ type \}\)/);
  assert.match(source, /authClient\.signOut\(\)/);
  assert.match(source, /KIOSK_IDLE_TIMEOUT_MS/);
  assert.match(source, /visibilitychange/);
});

test("kiosk desktop roster is contained, scannable, and keeps controls large", async () => {
  const css = await readFile(new URL("./kiosk.css", featureRoot), "utf8");

  assert.doesNotMatch(css, /\.kiosk-shell\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.kiosk-panel\s*\{[^}]*max-width:\s*1120px;/s);
  assert.match(css, /\.kiosk-roster\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(css, /\.kiosk-mechanic\s*\{[^}]*min-height:\s*88px;/s);
  assert.match(css, /\.kiosk-mechanic strong\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /@media \(max-width:\s*860px\)/);
  assert.match(css, /\.kiosk-language select\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(css, /\.kiosk-primary-action\s*\{[^}]*min-height:\s*56px;/s);
  assert.match(css, /\.kiosk-footer-actions button,[\s\S]*min-height:\s*44px;/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
