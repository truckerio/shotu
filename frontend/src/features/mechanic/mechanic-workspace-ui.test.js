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
  assert.match(workspace, /WorkspaceCreateActions/);
});

test("mechanic home keeps a readable desktop column and overflow-safe children", () => {
  assert.match(css, /--mechanic-home-max-width:\s*1440px/);
  assert.match(css, /\.mechanic-home-content[\s\S]*max-width:\s*var\(--mechanic-home-max-width\)/);
  assert.match(css, /\.mechanic-home-content[\s\S]*min-width:\s*0/);
  assert.match(css, /\.mechanic-next-job[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*1366px\)/);
});
