import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const indexPath = fileURLToPath(new URL("../../index.html", import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".js", ".jsx", ".css"].includes(extname(entry.name)) || entry.name.endsWith(".test.js") || path === thisFile) return [];
    return [path];
  });
}

test("frontend renders no Owl logo or wordmark", () => {
  const forbiddenBranding = /OwlWordmark|OwlProfileMark|owl-wordmark|owl-profile-mark/;
  const offenders = sourceFiles(sourceRoot)
    .filter((path) => forbiddenBranding.test(readFileSync(path, "utf8")));

  assert.deepEqual(offenders, []);
  assert.doesNotMatch(readFileSync(indexPath, "utf8"), /<title>\s*Owl\s*<\/title>/);
});

test("auth and account entry points use text or user identity instead of branding", () => {
  const login = readFileSync(join(sourceRoot, "features/auth/LoginPage.jsx"), "utf8");
  const invitation = readFileSync(join(sourceRoot, "features/admin/InviteAcceptPage.jsx"), "utf8");
  const profile = readFileSync(join(sourceRoot, "components/account/ProfileMenu.jsx"), "utf8");

  assert.match(login, /auth-heading-text-only/);
  assert.match(invitation, /auth-heading-text-only/);
  assert.match(profile, /profile-menu-initials/);
  assert.match(profile, /aria-label="Open account menu"/);
});
