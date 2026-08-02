import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const previewController = readFileSync(new URL("./useWorkorderPreviewController.js", import.meta.url), "utf8");

test("available work can be accepted from opened mechanic detail", () => {
  assert.match(
    detailPage,
    /activeWorkorder\.allowedActions\?\.accept[\s\S]*aria-label="Accept work and start this job"/,
  );
  assert.match(
    roleRouter,
    /async function acceptOpenedMechanicWorkorder\(\)[\s\S]*\/accept[\s\S]*\/api\/mechanic\/workorders\/\$\{encodeURIComponent\(workorderId\)\}[\s\S]*mechanicProgress\.reset/,
  );
});

test("desktop mechanic Help stays in the primary detail panel", () => {
  assert.match(
    previewController,
    /if \(!activeWorkorder \|\| actorRole === "mechanic" \|\| isCompact \|\| detailSection !== "chat"\) return;/,
  );
});
