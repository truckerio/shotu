import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const mechanicActions = readFileSync(new URL("../mechanic/useMechanicWorkorderActions.js", import.meta.url), "utf8");
const mechanicWorkspace = readFileSync(new URL("../mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("./WorkorderDetailSections.jsx", import.meta.url), "utf8");
const previewController = readFileSync(new URL("./useWorkorderPreviewController.js", import.meta.url), "utf8");

test("available work can be accepted from opened mechanic detail", () => {
  assert.match(
    detailPage,
    /activeWorkorder\.allowedActions\?\.accept[\s\S]*aria-label=\{t\("detail\.acceptStart"\)\}/,
  );
  assert.match(
    mechanicActions,
    /async function acceptOpenedMechanicWorkorder\(\)[\s\S]*\/accept[\s\S]*detailLoader\(\{ role: "mechanic", workorderId \}\)[\s\S]*mechanicProgress\.reset/,
  );
  assert.match(roleRouter, /useMechanicWorkorderActions/);
});

test("desktop mechanic Help stays in the primary detail panel", () => {
  assert.match(
    previewController,
    /if \(!activeWorkorder \|\| actorRole === "mechanic" \|\| isCompact \|\| detailSection !== "chat"\) return;/,
  );
});

test("part request refresh preserves unsaved mechanic progress", () => {
  assert.match(
    detailSections,
    /onChanged: \(\) => reloadActiveWorkorder\(\{[\s\S]*preserveForm: Boolean\(isMechanicDetail && mechanicProgress\?\.hasUnsyncedChanges\),[\s\S]*\}\)/,
  );
});

test("mechanic phone header retains access to the shared create and profile owner", () => {
  assert.match(mechanicWorkspace, /<WorkspaceCreateActions[\s\S]*actor=\{actor\}[\s\S]*onCreateWorkorder=\{onCreateWorkorder\}/);
});
