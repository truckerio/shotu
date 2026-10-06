import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reporting UI uses a location-scoped endpoint and keeps amounts grouped", () => {
  const source = readFileSync(new URL("./CustomerDocumentReports.jsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/customer-documents\/reports\?\$\{params\}/);
  assert.match(source, /companyId, locationId/);
  assert.match(source, /Amounts are grouped by currency/);
  assert.match(source, /Links needing attention/);
});
