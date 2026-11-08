import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { request } from "playwright";
import { resolveAuthConfig } from "./config.js";

// A shared browser cookie jar behaves like the in-app browser: localhost
// cookies are shared across ports even when servers use different databases.
test("signing into a second local app cannot replace the first app's session", async () => {
  const servers = [];
  const jar = await request.newContext();
  async function localApp() {
    let handler;
    const server = createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const config = resolveAuthConfig({ NODE_ENV: "test", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(32).toString("hex") });
    const auth = betterAuth({
      baseURL: config.baseURL,
      secret: config.secret,
      trustedOrigins: config.trustedOrigins,
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      session: { cookieCache: { enabled: false } },
      advanced: { cookiePrefix: config.cookiePrefix, useSecureCookies: config.secureCookies },
      logger: { level: "error" },
    });
    handler = toNodeHandler(auth);
    return origin;
  }
  async function session(origin) {
    const response = await jar.get(`${origin}/api/auth/get-session`);
    assert.equal(response.status(), 200);
    return response.json();
  }
  try {
    const first = await localApp();
    const second = await localApp();
    const password = `Local-test-${randomBytes(12).toString("hex")}`;
    for (const [origin, name] of [[first, "First"], [second, "Second"]]) {
      const response = await jar.post(`${origin}/api/auth/sign-up/email`, {
        headers: { origin }, data: { name, email: `${name.toLowerCase()}@example.test`, password },
      });
      assert.equal(response.status(), 200);
      assert.equal((await session(origin))?.user?.name, name);
    }
    assert.equal((await session(first))?.user?.name, "First", "Second local sign-in must not overwrite the first session cookie");
    const state = await jar.storageState();
    const cookieFor = origin => state.cookies.find(cookie => cookie.name === `${resolveAuthConfig({ BETTER_AUTH_URL: origin }).cookiePrefix}.session_token`);
    const firstCookie = cookieFor(first);
    const secondCookie = cookieFor(second);
    assert.ok(firstCookie);
    assert.ok(secondCookie);
    assert.equal(state.cookies.filter(cookie => cookie.name.endsWith(".session_token")).length, 2);
    const foreign = await request.newContext({ storageState: { cookies: [{ ...secondCookie, value: firstCookie.value }], origins: [] } });
    try {
      assert.equal(await (await foreign.get(`${second}/api/auth/get-session`)).json(), null, "A foreign instance token must fail closed even under the target cookie name");
    } finally { await foreign.dispose(); }

    // Explicit logout is scoped too; a valid cookie from another local
    // instance must never authenticate the signed-out app.
    const logout = await jar.post(`${second}/api/auth/sign-out`, { headers: { origin: second }, data: {} });
    assert.equal(logout.status(), 200);
    assert.equal(await session(second), null);
    assert.equal((await session(first))?.user?.name, "First");
    const anonymous = await request.newContext();
    try {
      assert.equal(await (await anonymous.get(`${first}/api/auth/get-session`)).json(), null);
    } finally { await anonymous.dispose(); }
  } finally {
    await jar.dispose();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
});
