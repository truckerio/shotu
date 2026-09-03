import assert from "node:assert/strict";
import test from "node:test";
import { readMechanicQueueSession, writeMechanicQueueSession } from "./mechanic-queue-session.js";

test("mixed mechanic queue session restores tab and search after detail navigation", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  writeMechanicQueueSession({ tab: "done", search: "INS-44" }, storage);
  assert.deepEqual(readMechanicQueueSession(storage), { tab: "done", search: "INS-44" });
});
