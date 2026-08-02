import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outletUrl = new URL("./RoleWorkspaceOutlet.jsx", import.meta.url);
const routerUrl = new URL("./RoleRouter.jsx", import.meta.url);

test("workspace composition has one owner outside RoleRouter", async () => {
  const [outletSource, routerSource] = await Promise.all([
    readFile(outletUrl, "utf8"),
    readFile(routerUrl, "utf8"),
  ]);

  assert.ok(
    routerSource.trimEnd().split("\n").length < 500,
    "RoleRouter must remain a route coordinator below 500 lines",
  );

  for (const workspace of ["mechanic", "admin", "office", "surveillance"]) {
    assert.match(outletSource, new RegExp(`workspace === ["']${workspace}["']`));
    assert.doesNotMatch(routerSource, new RegExp(`workspace === ["']${workspace}["']`));
  }
  assert.match(outletSource, /<WorkorderDetailPage/);
  assert.match(outletSource, /<CreateWorkorderPage/);
  assert.match(routerSource, /import \{ readInitialWorkspace, replaceRouteSearch, routeStartsLoading \}/);
});
