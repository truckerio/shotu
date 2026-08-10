import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./MechanicWorkspace.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./mechanic-workspace.css", import.meta.url), "utf8");

test("desktop mechanic home exposes one next-job action and secondary tools", () => {
  assert.match(workspace, /<h2>\{t\("mechanic\.nextJob"\)\}<\/h2>/);
  assert.match(workspace, /className="[^"]*mechanic-next-job-action[^"]*"/);
  assert.match(workspace, /mechanicJobActionKey\(nextJob\)/);
  assert.match(workspace, /<summary>[\s\S]*detail\.more[\s\S]*<\/summary>/);
  assert.match(workspace, /mechanic\.searchAndFilters/);
});

test("create workorder stays visible with primary mechanic queues instead of More", () => {
  const primaryStart = workspace.indexOf('className="mechanic-primary-queues"');
  const createAction = workspace.indexOf('className="mechanic-primary-create"');
  const moreStart = workspace.indexOf('className="mechanic-home-more"');

  assert.ok(primaryStart >= 0);
  assert.ok(createAction > primaryStart);
  assert.ok(createAction < moreStart);
  assert.equal(workspace.slice(moreStart).includes("mechanic.createWorkorder"), false);
  assert.match(css, /\.mechanic-primary-create[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*\.mechanic-primary-create[\s\S]*width:\s*100%/);
});

test("mechanic home keeps a readable desktop column and overflow-safe children", () => {
  assert.match(css, /--mechanic-home-max-width:\s*1440px/);
  assert.match(css, /\.mechanic-home-content[\s\S]*max-width:\s*var\(--mechanic-home-max-width\)/);
  assert.match(css, /\.mechanic-home-content[\s\S]*min-width:\s*0/);
  assert.match(css, /\.mechanic-next-job[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*1366px\)/);
});
