import assert from "node:assert/strict";
import test from "node:test";
import { buildInvitationUrl, invitationPublicOrigin } from "./invitation-link.js";

test("invitation links prefer the configured public HTTPS origin", () => {
  const req = {
    headers: { host: "junior.internal:8080", "x-forwarded-proto": "http" },
    socket: {},
  };
  assert.equal(
    invitationPublicOrigin(req, { BETTER_AUTH_URL: "https://junior01.up.railway.app/auth" }),
    "https://junior01.up.railway.app",
  );
});

test("invitation links respect proxy headers when no public URL is configured", () => {
  const req = {
    headers: {
      host: "junior.internal:8080",
      "x-forwarded-host": "junior01.up.railway.app",
      "x-forwarded-proto": "https",
    },
    socket: {},
  };
  assert.equal(invitationPublicOrigin(req, {}), "https://junior01.up.railway.app");
});

test("invitation tokens are encoded without changing their value", () => {
  const token = "token_with-safe.characters";
  const url = new URL(buildInvitationUrl("https://junior01.up.railway.app", token));
  assert.equal(url.origin, "https://junior01.up.railway.app");
  assert.equal(url.searchParams.get("invite"), token);
});
