import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  expiredKioskDeviceCookie,
  kioskDeviceCookie,
  kioskDeviceTokenFromCookie,
} from "./kiosk-cookie.js";
import {
  isStrongKioskPin,
  issueKioskPinSchema,
  kioskUnlockSchema,
} from "./kiosk.schemas.js";
import {
  createKioskDeviceToken,
  hashKioskDeviceToken,
} from "./kiosk.service.js";

const migrationUrl = new URL("../../db/migrations/034_kiosk_mode.sql", import.meta.url);
const pluginUrl = new URL("../../auth/kiosk-plugin.js", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/kiosk.repo.js", import.meta.url);
const routeUrl = new URL("../../routes/kiosk.routes.js", import.meta.url);
const adminRouteUrl = new URL("../../routes/admin.routes.js", import.meta.url);

test("kiosk PIN contract accepts strong variable-length values with a four-digit minimum", () => {
  assert.equal(isStrongKioskPin("7391"), true);
  assert.equal(isStrongKioskPin("739185"), true);
  assert.equal(isStrongKioskPin("7391852047"), true);
  for (const pin of ["123", "abcdef", "1111", "1234", "123456", "654321", "1212"]) {
    assert.equal(isStrongKioskPin(pin), false, pin);
    assert.equal(issueKioskPinSchema.safeParse({ pin }).success, false, pin);
  }
  assert.equal(kioskUnlockSchema.safeParse({
    mechanicId: "11111111-1111-4111-8111-111111111111",
    pin: "739185",
    newPin: "804297",
  }).success, true);
});

test("device credential uses 256 bits and only its SHA-256 hash has database shape", () => {
  const token = createKioskDeviceToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const hash = hashKioskDeviceToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes(token), false);
});

test("device cookie is HttpOnly strict and secure only in production", () => {
  const token = createKioskDeviceToken();
  const development = kioskDeviceCookie(token, { NODE_ENV: "development" });
  assert.match(development, /HttpOnly/);
  assert.match(development, /SameSite=Strict/);
  assert.match(development, /Path=\//);
  assert.doesNotMatch(development, /Secure/);
  assert.equal(kioskDeviceTokenFromCookie(`other=x; ${development.split(";")[0]}`), token);

  const production = kioskDeviceCookie(token, { NODE_ENV: "production" });
  assert.match(production, /Secure/);
  assert.match(expiredKioskDeviceCookie({ NODE_ENV: "production" }), /Max-Age=0/);
});

test("migration preserves Better Auth and adds scoped kiosk security tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "kiosk_devices",
    "mechanic_kiosk_credentials",
    "kiosk_unlock_failures",
    "kiosk_session_context",
    "kiosk_audit_events",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /token_hash text not null unique/);
  assert.match(sql, /references auth_session\(id\) on delete cascade/);
  assert.match(sql, /foreign key \(company_id, location_id\)/);
  assert.doesNotMatch(sql, /alter table auth_(user|session|account)/);
});

test("unlock plugin creates a normal Better Auth session before setting its cookie", async () => {
  const source = await readFile(pluginUrl, "utf8");
  assert.match(source, /createAuthEndpoint\("\/kiosk\/unlock"/);
  assert.match(source, /internalAdapter\.createSession\(user\.id\)/);
  assert.match(source, /finishUnlock\(\{/);
  assert.match(source, /setSessionCookie\(ctx, \{ session, user \}\)/);
  assert.ok(source.indexOf("finishUnlock({") < source.indexOf("setSessionCookie(ctx"));
  assert.match(source, /internalAdapter\.deleteSession\(session\.token\)/);
});

test("repository enforces five-attempt lockout and companion session audit", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /const MAX_FAILURES = 5/);
  assert.match(source, /const FAILURE_WINDOW_MINUTES = 15/);
  assert.match(source, /const LOCK_MINUTES = 15/);
  assert.match(source, /company_membership\.role = 'mechanic'/);
  assert.match(source, /insert into kiosk_session_context/);
  assert.match(source, /["']unlock_succeeded["']/);
  assert.doesNotMatch(source, /select\s+[^;]*(contact_email|username|phone)/i);
});

test("public kiosk context exposes only device identity and minimal mechanic roster", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /registered:\s*false/);
  assert.match(source, /locationName:\s*context\.device\.locationName/);
  assert.match(source, /mechanics:\s*context\.mechanics/);
  assert.doesNotMatch(source, /contactEmail|username|phone|permissions/);
});

test("admin routes expose exact scoped registration, revocation, and PIN contracts", async () => {
  const source = await readFile(adminRouteUrl, "utf8");
  assert.match(source, /"\/kiosk-devices\/register"/);
  assert.match(source, /"\/revoke"/);
  assert.match(source, /"\/kiosk-pin"/);
  assert.match(source, /issueKioskPinSchema\.safeParse/);
  assert.match(source, /sendJson\(res,\s*400/);
  assert.match(source, /kioskDeviceCookie\(registered\.token\)/);
  assert.match(source, /sendJson\(res, 201, \{ device: registered\.device \}\)/);
  assert.doesNotMatch(source, /sendJson\([^)]*registered\.token/);
});
