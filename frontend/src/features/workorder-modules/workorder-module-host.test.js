import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { moduleRenderer } from "./module-renderer-catalog.js";

const detailHost = readFileSync(new URL("./WorkorderDetailModuleHost.jsx", import.meta.url), "utf8");
const createHost = readFileSync(new URL("./WorkorderCreateModuleHost.jsx", import.meta.url), "utf8");
const previewManifest = readFileSync(new URL("./preview/manifest.js", import.meta.url), "utf8");

test("normal module renderers are injected into registry-driven hosts without page switches", () => {
  const FixtureModule = () => null;
  assert.equal(moduleRenderer("fixture", { fixture: FixtureModule }), FixtureModule);
  assert.match(detailHost, /renderers = DETAIL_MODULE_RENDERERS/);
  assert.match(detailHost, /sections\.map/);
  assert.match(detailHost, /detailModuleRenderer\(section\.id, renderers\)/);
  assert.match(createHost, /renderers = CREATE_MODULE_RENDERERS/);
  assert.match(createHost, /sections\.map/);
  assert.match(createHost, /createModuleRenderer\(section\.id, renderers\)/);
  assert.doesNotMatch(detailHost, /switch\s*\(/);
  assert.doesNotMatch(createHost, /switch\s*\(/);
});

test("Preview declares its intentional supporting placement in its owner manifest", () => {
  assert.match(previewManifest, /placementBySurface: Object\.freeze\(\{ create: "supporting", detail: "supporting" \}\)/);
  assert.match(detailHost, /placementBySurface\?\.detail === "supporting"/);
  assert.match(createHost, /placementBySurface\?\.create === "supporting"/);
});
