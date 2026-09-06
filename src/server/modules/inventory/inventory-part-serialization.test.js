import assert from "node:assert/strict";
import test from "node:test";
import { inventoryPartSerializationInternals } from "../../db/repositories/inventory-part-serialization.repo.js";

const { generatedSerial, serialPartToken } = inventoryPartSerializationInternals;

test("future local serials identify the part while retaining a stable unique batch token", () => {
  const batchId = "2513afd6-a6d0-48c9-a1bb-112233445566";
  assert.equal(generatedSerial("295/75R22.5 Marathon", batchId, 1), "WG-295-75R22-5-MARATHON-2513AFD6A6D048C9-1");
  assert.equal(generatedSerial("295/75R22.5 Marathon", batchId, 2), "WG-295-75R22-5-MARATHON-2513AFD6A6D048C9-2");
});

test("serial part tokens are label-safe, bounded, and have a readable fallback", () => {
  assert.equal(serialPartToken("  Béarïng / Seal #42  "), "BEARING-SEAL-42");
  assert.equal(serialPartToken("***"), "PART");
  assert.equal(serialPartToken("ABCDEFGHIJKLMNOPQRSTUVWXYZ-123"), "ABCDEFGHIJKLMNOPQRSTUVWX");
});
