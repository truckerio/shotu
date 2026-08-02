import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserBenchmarkConfig, publicBrowserConfig } from "./browser-config.js";

test("browser benchmark config is role aware and secret free", () => {
  const config = parseBrowserBenchmarkConfig({
    PERF_BROWSER_ROLE: "surveillance",
    PERF_BROWSER_IDENTIFIER: "qa-surveillance",
    PERF_BROWSER_PASSWORD: "secret-value",
  });
  assert.equal(config.rowSelector.includes("surveillance"), true);
  assert.deepEqual(config.viewport, { width: 390, height: 844 });
  assert.doesNotMatch(JSON.stringify(publicBrowserConfig(config)), /secret-value|qa-surveillance/);
});

test("browser benchmark rejects unsupported roles", () => {
  assert.throws(() => parseBrowserBenchmarkConfig({
    PERF_BROWSER_ROLE: "owner",
    PERF_BROWSER_IDENTIFIER: "owner",
    PERF_BROWSER_PASSWORD: "secret",
  }), /must be one of/);
});
