import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("serialized-part scanner shares the synchronous camera session lifecycle", async () => {
  const source = await readFile(new URL("./InventoryCodeScanner.jsx", import.meta.url), "utf8");

  assert.match(source, /import \{ createInventoryCameraSession \} from "\.\/inventory-camera-session\.js"/);
  assert.match(source, /const token = session\.begin\(\);/);
  assert.match(source, /if \(!token\) return;/);
  assert.match(source, /session\.stopIfStale\(token, stream\)/);
  assert.match(source, /if \(!session\.isCurrent\(token\) \|\| !videoRef\.current \|\| inFlightRef\.current\) return;/);
  assert.match(source, /function stopCamera\(\) \{\s*cameraSessionRef\.current\.cancel\(\);/s);
  assert.match(source, /mountedRef\.current = false;\s*scanGenerationRef\.current \+= 1;\s*stopCamera\(\);/s);
});
