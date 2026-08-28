import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const flow = readFileSync(new URL("./GetPartsFlow.jsx", import.meta.url), "utf8"); const css = readFileSync(new URL("./get-parts-flow.css", import.meta.url), "utf8");
test("Get Parts keeps the request small and exposes recovery-safe route states", () => {
  assert.match(flow, /neededBy/); assert.match(flow, /destinationLocationId/); assert.match(flow, /aria-live="polite"/);
  assert.match(flow, /Transfer is not complete until a future confirmed movement/); assert.match(flow, /role="alert"/);
  assert.match(flow, /Recommendation approved/); assert.match(flow, /Stock is not reserved or moved yet/);
  assert.match(flow, /const titleId = useId\(\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
});
