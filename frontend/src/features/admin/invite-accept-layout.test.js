import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./InviteAcceptPage.jsx", import.meta.url), "utf8");
const authCss = readFileSync(new URL("../auth/auth.css", import.meta.url), "utf8");
const passwordCss = readFileSync(new URL("../../components/ui/password-visibility-toggle.css", import.meta.url), "utf8");

test("invitation page uses a collision-free compact phone header", () => {
  assert.match(page, /auth-shell auth-invite-shell/);
  assert.match(page, /auth-panel auth-invite-panel/);
  assert.match(page, /auth-heading auth-invite-heading/);
  assert.match(page, /auth-invite-brand-row/);

  const phoneCss = authCss.slice(authCss.indexOf("@media (max-width: 520px)"));
  assert.match(phoneCss, /\.auth-invite-heading \.auth-mark\s*\{[\s\S]*display: none;/);
  assert.match(phoneCss, /\.auth-invite-heading \.auth-heading-copy\s*\{[\s\S]*width: 100%;/);
});

test("invitation form controls cannot overflow the card", () => {
  assert.match(authCss, /\.auth-form input\s*\{[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;/);
  assert.match(authCss, /\.auth-form input:disabled\s*\{[\s\S]*opacity: 1;/);
  assert.match(passwordCss, /\.password-input-control\s*\{[\s\S]*box-sizing: border-box;[\s\S]*min-width: 0;[\s\S]*width: 100%;/);
});
