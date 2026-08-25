import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("./InvoiceExtractionWorkspace.jsx", import.meta.url);
const officeWorkspaceUrl = new URL("./OfficeWorkspace.jsx", import.meta.url);

test("explicit invoice links win over saved queue preferences", async () => {
  const source = await readFile(officeWorkspaceUrl, "utf8");
  assert.match(source, /return \["drafts", "invoices"\]\.includes\(requested\) \? requested : ""/);
  assert.match(source, /const savedTabCandidate = !requestedWorkspace/);
  assert.match(source, /: requestedWorkspace \|\| "needs"/);
});

test("refreshed review restores only the authorized source route and keeps learning opt-in explicit", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /\/api\/office\/invoice-extractions\/\$\{encodeURIComponent\(run\.id\)\}\/source/);
  assert.match(source, /Save this reviewed invoice as training data for our future local extractor/);
  assert.match(source, /useState\(false\)/);
  assert.doesNotMatch(source, /original file preview is not retained/i);
});

test("upload defaults to one action, supports bounded multi-select, and progressively discloses vendor context", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /locations\.length > 1/);
  assert.match(source, /className="invoice-upload-context"/);
  assert.match(source, /import \{ FormField, OptionalSection \} from "\.\.\/\.\.\/components\/forms\/index\.js"/);
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx"/);
  assert.match(source, /<OptionalSection className="invoice-upload-options" title="More options">/);
  assert.match(source, /<FormField label="Vendor name \(optional\)">/);
  assert.match(source, /onChange=\{chooseFiles\} multiple required/);
  assert.match(source, /Up to 10 PDFs or images · 10 MB each/);
  assert.match(source, /for \(let index = 0; index < uploads\.length; index \+= 1\)/);
  assert.match(source, /idempotencyKey: upload\.idempotencyKey/);
  assert.match(source, /Invoice \{batchIndex \+ 1\} of \{batchRuns\.length\}/);
  assert.match(source, /\{uploads\.length \? <Button className="invoice-upload-submit"/);
  assert.match(source, /Encrypted · Training use requires your approval/);
  assert.doesNotMatch(source, /Extract a parts invoice/);
  assert.doesNotMatch(source, /<button\b/);
});
