import assert from "node:assert/strict";
import test from "node:test";
import { auth } from "./auth.js";

test("kiosk plugin is additive to standard Better Auth endpoints", () => {
  assert.equal(typeof auth.api.signInEmail, "function");
  assert.equal(typeof auth.api.signInUsername, "function");
  assert.equal(typeof auth.api.kioskUnlock, "function");
});

test("kiosk unlock fails generically before database access when device cookie is missing", async () => {
  await assert.rejects(
    auth.api.kioskUnlock({
      headers: new Headers({
        origin: process.env.BETTER_AUTH_URL || "http://localhost:4173",
      }),
      body: {
        mechanicId: "11111111-1111-4111-8111-111111111111",
        pin: "739185",
      },
    }),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.body?.message, "Unable to unlock kiosk.");
      return true;
    },
  );
});
