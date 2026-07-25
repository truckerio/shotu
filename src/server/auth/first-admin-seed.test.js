import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapFirstAdmin,
  ensureAuthIdentity,
  parseFirstAdminConfig,
  safeErrorMessage,
} from "../db/seeds/first-admin.js";

const validEnvironment = {
  NODE_ENV: "production",
  ADMIN_EMAIL: "Owner@Example.com",
  ADMIN_USERNAME: "Owner.Admin",
  ADMIN_NAME: "Operations Owner",
  ADMIN_PASSWORD: "a-safe-admin-password",
};

test("first-admin config fails closed when production inputs are missing", () => {
  assert.throws(
    () => parseFirstAdminConfig({ NODE_ENV: "production" }),
    /ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_NAME, ADMIN_PASSWORD are required in production/,
  );
});

test("first-admin config normalizes identity and derives a company slug", () => {
  const config = parseFirstAdminConfig({
    ...validEnvironment,
    COMPANY_NAME: "Pro Tec Repair",
    LOCATION_NAME: "Chino Yard",
  });

  assert.equal(config.email, "owner@example.com");
  assert.equal(config.username, "owner.admin");
  assert.equal(config.companySlug, "pro-tec-repair");
  assert.equal(config.companyName, "Pro Tec Repair");
  assert.equal(config.locationName, "Chino Yard");
});

test("first-admin config rejects weak passwords and invalid explicit slugs", () => {
  assert.throws(
    () => parseFirstAdminConfig({ ...validEnvironment, ADMIN_PASSWORD: "too-short" }),
    /at least 12 characters/,
  );
  assert.throws(
    () => parseFirstAdminConfig({ ...validEnvironment, COMPANY_SLUG: "Not Safe" }),
    /lowercase kebab-case/,
  );
});

test("auth identity creation delegates password handling to Better Auth", async () => {
  const input = parseFirstAdminConfig(validEnvironment);
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  let signUpBody;
  const authApi = {
    async signUpEmail({ body }) {
      signUpBody = body;
      return { user: { id: "auth-owner" } };
    },
  };

  const result = await ensureAuthIdentity({ pool, authApi, input });

  assert.deepEqual(result, { authUserId: "auth-owner", created: true });
  assert.equal(signUpBody.password, validEnvironment.ADMIN_PASSWORD);
  assert.equal(signUpBody.username, "owner.admin");
  assert.equal(queries.length, 2);
  assert.ok(queries.every(({ sql }) => !sql.includes("insert into auth_account")));
});

test("existing identity remains idempotent and requires a credential account", async () => {
  const input = parseFirstAdminConfig(validEnvironment);
  const responses = [
    { rows: [{ id: "auth-owner", email: input.email, username: input.username }] },
    { rows: [{ "?column?": 1 }] },
  ];
  const pool = {
    async query() {
      return responses.shift();
    },
  };

  const result = await ensureAuthIdentity({
    pool,
    authApi: { signUpEmail: () => assert.fail("must not create an existing identity") },
    input,
  });

  assert.deepEqual(result, { authUserId: "auth-owner", created: false });
});

test("existing email cannot be silently taken over with another username", async () => {
  const input = parseFirstAdminConfig(validEnvironment);
  const pool = {
    async query() {
      return {
        rows: [{ id: "auth-owner", email: input.email, username: "somebody-else" }],
      };
    },
  };

  await assert.rejects(
    ensureAuthIdentity({ pool, authApi: {}, input }),
    /without the requested username/,
  );
});

test("bootstrap cleans a newly-created auth identity if domain linking fails", async () => {
  let cleanupId;
  const operations = {
    async ensureAuthIdentity() {
      return { authUserId: "auth-new", created: true };
    },
    async linkDomainAdmin() {
      throw new Error("domain link failed");
    },
    async cleanupNewAuthIdentity({ authUserId }) {
      cleanupId = authUserId;
      return true;
    },
  };

  await assert.rejects(
    bootstrapFirstAdmin({
      environment: validEnvironment,
      pool: {},
      authApi: {},
      logger: { log: () => assert.fail("failed bootstrap must not log success") },
      operations,
    }),
    /domain link failed/,
  );
  assert.equal(cleanupId, "auth-new");
});

test("domain links resolve the company slug and use its UUID", async () => {
  const { linkDomainAdmin } = await import("../db/seeds/first-admin.js");
  const companyId = "00000000-0000-0000-0000-000000000001";
  const locationId = "10000000-0000-0000-0000-000000000001";
  const appUserId = "20000000-0000-0000-0000-000000000001";
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("from companies")) {
        return { rows: [{ id: companyId, slug: "default", name: "Default Company" }] };
      }
      if (sql.includes("update companies")) {
        return { rows: [{ id: companyId, slug: "default", name: "Default Company" }] };
      }
      if (sql.includes("from locations") && sql.includes("active = true")) {
        return { rows: [{ id: locationId, name: "Main Location" }] };
      }
      if (sql.includes("from app_users")) return { rows: [] };
      if (sql.includes("insert into app_users")) return { rows: [{ id: appUserId }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  const result = await linkDomainAdmin({
    pool,
    input: parseFirstAdminConfig(validEnvironment),
    authUserId: "auth-owner",
  });

  assert.equal(result.companyId, companyId);
  assert.equal(result.companySlug, "default");
  assert.match(result.companyId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const locationQuery = calls.find(({ sql }) => sql.includes("from locations") && sql.includes("active = true"));
  const membershipQuery = calls.find(({ sql }) => sql.includes("insert into user_company_memberships"));
  assert.deepEqual(locationQuery.params, [companyId]);
  assert.deepEqual(membershipQuery.params, [appUserId, companyId]);
});

test("first admin adopts the single migrated default company instead of creating a duplicate tenant", async () => {
  const { linkDomainAdmin } = await import("../db/seeds/first-admin.js");
  const companyId = "00000000-0000-0000-0000-000000000001";
  const locationId = "10000000-0000-0000-0000-000000000001";
  const appUserId = "20000000-0000-0000-0000-000000000001";
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("from companies") && sql.includes("where slug")) return { rows: [] };
      if (sql.includes("from companies") && sql.includes("where active = true")) {
        return { rows: [{ id: companyId, slug: "default", name: "Default Company" }] };
      }
      if (sql.includes("update companies")) {
        return { rows: [{ id: companyId, slug: "pro-tec-repair", name: "Pro Tec Repair" }] };
      }
      if (sql.includes("from locations") && sql.includes("active = true")) {
        return { rows: [{ id: locationId, name: "Chino Yard" }] };
      }
      if (sql.includes("from app_users")) return { rows: [] };
      if (sql.includes("insert into app_users")) return { rows: [{ id: appUserId }] };
      return { rows: [] };
    },
    release() {},
  };

  const result = await linkDomainAdmin({
    pool: { async connect() { return client; } },
    input: parseFirstAdminConfig({
      ...validEnvironment,
      COMPANY_NAME: "Pro Tec Repair",
      COMPANY_SLUG: "pro-tec-repair",
    }),
    authUserId: "auth-owner",
  });

  assert.equal(result.companyId, companyId);
  assert.equal(result.companySlug, "pro-tec-repair");
  assert.equal(calls.some(({ sql }) => sql.includes("insert into companies")), false);
});

test("successful bootstrap output never includes the password", async () => {
  let output = "";
  const companyId = "00000000-0000-0000-0000-000000000001";
  const result = await bootstrapFirstAdmin({
    environment: validEnvironment,
    pool: {},
    authApi: {},
    logger: { log: (value) => { output = value; } },
    operations: {
      async ensureAuthIdentity() {
        return { authUserId: "auth-owner", created: false };
      },
      async linkDomainAdmin() {
        return {
          appUserId: "app-owner",
          companyId,
          companySlug: "default",
          companyName: "Default Company",
          locationId: "location-main",
          locationName: "Main Location",
        };
      },
    },
  });

  assert.equal(result.role, "admin");
  assert.equal(result.companyId, companyId);
  assert.equal(result.companySlug, "default");
  assert.match(result.companyId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(output, new RegExp(validEnvironment.ADMIN_PASSWORD));
  assert.doesNotMatch(JSON.stringify(result), /password/i);
});

test("safe errors redact the configured password", () => {
  assert.equal(
    safeErrorMessage(
      new Error(`request failed for ${validEnvironment.ADMIN_PASSWORD}`),
      validEnvironment.ADMIN_PASSWORD,
    ),
    "request failed for [REDACTED]",
  );
});
