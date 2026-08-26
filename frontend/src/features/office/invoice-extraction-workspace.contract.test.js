import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("./InvoiceExtractionWorkspace.jsx", import.meta.url);
const viewerUrl = new URL("./InvoiceDocumentViewer.jsx", import.meta.url);
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
  assert.match(source, /Use this reviewed invoice and its corrections for future OpenAI extraction context and governed local extraction learning/);
  assert.match(source, /useState\(false\)/);
  assert.doesNotMatch(source, /original file preview is not retained/i);
});

test("invoice upload timeout covers sequential local OCR and OpenAI extraction", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /timeoutMs: 195_000/);
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

test("invoice review stays compact while confidence and evidence remain available", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /className="invoice-field-heading"/);
  assert.match(source, /<Confidence field=\{field\} optional=\{options\.optional\} \/>/);
  assert.match(source, /<details className="invoice-field-evidence">/);
  assert.match(source, /title="Additional details"/);
  assert.match(source, /PO number only if your company gave one to the seller\./);
  assert.match(source, /invoiceFieldNeedsReview\(candidate\.field, candidate\.options\)/);
});

test("completed invoice status banners dismiss after 1.5 seconds without hiding actionable alerts", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const STATUS_DISMISS_MS = 1_500/);
  assert.match(source, /if \(!message \|\| busy\) return undefined;/);
  assert.match(source, /window\.setTimeout\(\(\) => setMessage\(""\), STATUS_DISMISS_MS\)/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
  assert.match(source, /draft\.warnings\.length \? <div className="invoice-warning" role="alert">/);
});

test("invoice review always composes the reusable document viewer before the form", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /import \{ InvoiceDocumentViewer \}/);
  assert.match(source, /<div className="invoice-review-layout">[\s\S]*<InvoiceDocumentViewer[\s\S]*<div className="invoice-review-form">/);
  assert.doesNotMatch(source, /displayedPreviewUrl \? \(/);
});

test("document viewer toolkit keeps bounded controls and truthful unavailable state", async () => {
  const source = await readFile(viewerUrl, "utf8");
  assert.match(source, /role="toolbar" aria-label="Document viewer tools"/);
  for (const label of ["Zoom out", "Zoom in", "Reset document view", "Rotate image clockwise", "Open fullscreen document view", "Open original invoice in a new tab", "Download original invoice"]) assert.match(source, new RegExp(label));
  assert.match(source, /Document source unavailable/);
  assert.match(source, /isPdf[\s\S]*<object[\s\S]*<img/);
});
