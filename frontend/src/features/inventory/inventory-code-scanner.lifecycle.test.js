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

test("both inventory camera consumers enable autofocus only after a current stream is confirmed", async () => {
  const sources = await Promise.all([
    readFile(new URL("./InventoryCodeScanner.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryScanWorkspace.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    assert.match(source, /enableInventoryCameraContinuousAutofocus/);
    assert.match(
      source,
      /if \(!mountedRef\.current \|\| !session\.isCurrent\(token\)\) \{\s*session\.stopIfStale\(token, stream\);\s*return;\s*\}\s*await enableInventoryCameraContinuousAutofocus\(stream\);\s*if \(!mountedRef\.current \|\| !session\.isCurrent\(token\)\)/s,
    );
  }
});
