import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useVehicleLookupController.js", import.meta.url),
  "utf8",
);

test("vehicle search debounce is not restarted by callback identity changes", () => {
  assert.match(source, /const applyVehicleRef = useRef\(null\)/);
  assert.match(source, /applyVehicleRef\.current = applyVehicle/);
  assert.match(source, /applyVehicleRef\.current\(exactMatch\)/);
  assert.match(source, /\}, \[form\.unitNo, selectedVehicle\]\);/);
  assert.doesNotMatch(source, /\}, \[applyVehicle, form\.unitNo, selectedVehicle\]\);/);
});

test("vehicle search has a bounded request timeout", () => {
  assert.match(
    source,
    /api\(`\/api\/vehicles\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=8`, \{ timeoutMs: 10_000 \}\)/,
  );
});
