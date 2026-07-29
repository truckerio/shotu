import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STANDARD_SESSION_MAX_AGE_SECONDS,
  STANDARD_SESSION_UPDATE_AGE_SECONDS,
} from "./session-policy.js";

test("remembered standard sessions last 24 hours and refresh hourly", async () => {
  assert.equal(STANDARD_SESSION_MAX_AGE_SECONDS, 86_400);
  assert.equal(STANDARD_SESSION_UPDATE_AGE_SECONDS, 3_600);

  const authSource = await readFile(new URL("./auth.js", import.meta.url), "utf8");
  assert.match(authSource, /expiresIn:\s*STANDARD_SESSION_MAX_AGE_SECONDS/);
  assert.match(authSource, /updateAge:\s*STANDARD_SESSION_UPDATE_AGE_SECONDS/);
});
