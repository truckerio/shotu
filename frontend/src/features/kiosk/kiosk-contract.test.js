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
  assert.match(source, /context\.mechanics\.map/);
  assert.match(source, /Use standard login/);
  assert.match(source, /aria-label=\{`Unlock as \$\{mechanic\.name\}`\}/);
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

test("kiosk phone surface prevents horizontal overflow and keeps touch controls large", async () => {
  const css = await readFile(new URL("./kiosk.css", featureRoot), "utf8");

  assert.match(css, /\.kiosk-shell\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.kiosk-primary-action\s*\{[^}]*min-height:\s*56px;/s);
  assert.match(css, /\.kiosk-footer-actions button,[\s\S]*min-height:\s*44px;/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
