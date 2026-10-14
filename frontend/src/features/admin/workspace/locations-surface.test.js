import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Locations uses the shared viewport-filling collection surface", () => {
  const page = readFileSync(new URL("./LocationsPage.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../admin.css", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../../../styles/workspace-consistency.css", import.meta.url), "utf8");
  assert.match(page, /<OperationalCollectionPage\s+className="admin-content admin-locations-content"/);
  assert.match(page, /className="admin-content admin-locations-content"\s+surface/);
  assert.match(page, /useClientCheckpointPages\(locations, \{ pageSize: 15 \}\)/);
  assert.match(page, /<CheckpointCollection[\s\S]*ariaLabel="Locations"[\s\S]*queue=\{\{ \.\.\.queue, loading \}\}[\s\S]*className="admin-location-table"/);
  assert.match(page, /<button \{\.\.\.rowProps\} className="admin-location-row"/);
  assert.doesNotMatch(page, /<Pagination/);
  assert.match(shared, /\.admin-shell \.operational-collection-page\.is-page:not\(\.admin-operations-content\)\s*\{[^}]*height: 100dvh;/);
  assert.match(shared, /\.operational-collection-page-body\s*\{[^}]*flex: 1 1 auto;[^}]*overflow: auto;/);
  assert.match(css, /\.admin-locations-content \.admin-location-table\s*\{[^}]*flex-shrink: 0;/);
});
