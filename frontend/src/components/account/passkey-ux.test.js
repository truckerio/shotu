import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountUrl = new URL("./PasskeyManager.jsx", import.meta.url);
const profileUrl = new URL("./ProfileMenu.jsx", import.meta.url);
const profileCssUrl = new URL("./profile-menu.css", import.meta.url);
const loginUrl = new URL("../../features/auth/LoginPage.jsx", import.meta.url);
const authClientUrl = new URL("../../lib/auth-client.js", import.meta.url);

test("auth client installs official passkey client plugin", async () => {
  const source = await readFile(authClientUrl, "utf8");
  assert.match(source, /@better-auth\/passkey\/client/);
  assert.match(source, /passkeyClient\(\)/);
});

test("login presents passkey first and retains password fallback", async () => {
  const source = await readFile(loginUrl, "utf8");
  assert.ok(source.indexOf("Sign in with a passkey") < source.indexOf("<Form"));
  assert.match(source, /authClient\.signIn\.passkey\(\)/);
  assert.match(source, /autoComplete="username webauthn"/);
  assert.match(source, /authClient\.signIn\.username/);
  assert.match(source, /authClient\.signIn\.email/);
});

test("profile menu exposes complete passkey management", async () => {
  const [profile, account] = await Promise.all([
    readFile(profileUrl, "utf8"),
    readFile(accountUrl, "utf8"),
  ]);
  assert.match(profile, /account\.managePasskeys/);
  assert.match(profile, /<PasskeyManager/);
  assert.match(account, /passkey\.addPasskey/);
  assert.match(account, /passkey\.listUserPasskeys/);
  assert.match(account, /passkey\.updatePasskey/);
  assert.match(account, /passkey\.deletePasskey/);
  assert.match(account, /account\.removePasskeyQuestion/);
  assert.match(account, /intlLocale\(locale\)/);
  assert.match(account, /role=\{status\.kind === "error" \? "alert" : "status"\}/);
});

test("passkey controls meet touch target floor", async () => {
  const css = await readFile(profileCssUrl, "utf8");
  assert.match(css, /\.passkey-close,[\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/);
});
