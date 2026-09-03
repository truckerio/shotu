import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queueUrl = new URL("./PartRequestQueue.jsx", import.meta.url);
const workspaceUrl = new URL("./OperationsWorkspace.jsx", import.meta.url);

test("shared part request queue uses the Office endpoint and request-level identity", async () => {
  const source = await readFile(queueUrl, "utf8");

  assert.match(source, /api\(`\/api\/office\/part-requests\/queue\?\$\{params\}`/);
  assert.match(source, /buildPartRequestsQuery\(filters, page\)/);
  for (const filter of ["search", "status", "supply", "sort", "page"]) assert.match(source, new RegExp(filter));
  assert.match(source, /key=\{request\.id\}/);
  assert.match(source, /onOpenWorkorder\(row\.workorderId, \{ partRequestId: request\.id \}\)/);
  assert.match(source, /OperationalCollectionToolbar/);
  assert.match(source, /OperationalCollectionTable/);
  assert.match(source, /OperationalCollectionRow/);
  assert.match(source, /OperationalCollectionCell/);
  assert.match(source, /className="part-request-queue-open"/);
  assert.match(source, /aria-label=\{`Open \$\{partIdentity\} request/);
  assert.match(source, /busy=\{result\.loading\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /clampPartRequestPage\(page, resolved\.pageCount\)/);
  assert.match(source, /setPage\(validPage\)/);
});

test("part requests share collection geometry and preserve compact cards", async () => {
  const css = await readFile(new URL("./operations.css", import.meta.url), "utf8");

  assert.match(css, /\.part-request-queue \{[\s\S]*min-width: 0;[\s\S]*width: 100%;[\s\S]*\}/);
  assert.doesNotMatch(css, /\.part-request-queue \{[^}]*max-width:/);
  assert.match(css, /\.operational-collection-table\.part-request-queue-table \{[\s\S]*--operational-collection-columns:/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*\.part-request-queue-cell \{[\s\S]*flex-direction: row;[\s\S]*flex-wrap: nowrap;[\s\S]*justify-content: flex-start;/);
  assert.match(css, /\.part-request-queue-open \{[^}]*text-align: left;[^}]*width: 100%;[^}]*\}/);
  assert.match(css, /\.part-request-queue-open:focus-visible \{ outline: 2px solid #2e6ee6;/);
  assert.doesNotMatch(css, /#84adff/);
});

test("Admin Parts gets its badge from the canonical request queue before the tab opens", async () => {
  const source = await readFile(workspaceUrl, "utf8");

  assert.match(source, /import \{ PartRequestQueue \} from "\.\/PartRequestQueue\.jsx"/);
  assert.match(source, /filters\.category === "parts" \? \(/);
  assert.match(source, /<PartRequestQueue/);
  assert.match(source, /import \{ usePartRequestQueueCount \} from "\.\/usePartRequestQueueCount\.js"/);
  assert.match(source, /usePartRequestQueueCount\(\{ locationId: fixedLocationId, refreshKey \}\)/);
  assert.match(source, /parts: partRequestCount\.total/);
  assert.doesNotMatch(source, /summary\.counts\.parts/);
  assert.match(source, /filters\.category === "drafts" \|\| filters\.category === "parts"/);
});
