import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../../app/routes/useWorkorderDetailRoute.js", import.meta.url), "utf8");
const surface = readFileSync(new URL("./OfficePartsSurface.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./legacy-part-requests.css", import.meta.url), "utf8");

test("request queue navigation opens the parts section and preserves the exact request", () => {
  assert.match(route, /openOfficeWorkorder = useCallback\(async \(workorderId, \{ partRequestId = "" \} = \{\}\)/);
  assert.match(route, /requestedSection: partRequestId \? "parts"/);
  assert.match(route, /workorderDetailSearch\(workorder\.id, nextSection, \{ partRequestId \}\)/);
});

test("office parts surface focuses a request selected from the queue", () => {
  assert.match(surface, /get\("partRequest"\)/);
  assert.match(surface, /scrollIntoView/);
  assert.match(surface, /\.focus\?\./);
  assert.match(surface, /tabIndex=\{request\.id === focusedRequestId \? -1/);
  assert.match(surface, /part-request-focus-target/);
  assert.match(surface, /aria-current=\{request\.id === focusedRequestId \? "true" : undefined\}/);
  assert.match(styles, /\.part-request-focus-target\.is-selected/);
  assert.match(styles, /outline: 3px solid/);
});
