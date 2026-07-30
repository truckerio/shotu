import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mechanicProgressRequest,
  normalizedMechanicProgress,
} from "./useMechanicProgress.js";

test("manual save request sends cleared Diagnosis and Repair completed values", async () => {
  const sent = [];
  const saveProgress = async (payload) => {
    sent.push(payload);
    return { progress: { ...payload, version: payload.expectedVersion + 1 } };
  };
  const renderedValue = normalizedMechanicProgress({
    diagnosis: "",
    workPerformed: "",
  });

  await saveProgress(mechanicProgressRequest({
    workorderId: "workorder-71",
    expectedVersion: 8,
    value: renderedValue,
    recordActivity: true,
  }));

  assert.deepEqual(sent, [{
    workorderId: "workorder-71",
    expectedVersion: 8,
    diagnosis: "",
    workPerformed: "",
    recordActivity: true,
  }]);
});

test("hook updates its save ref during same-workorder render before click handlers can flush", () => {
  const source = readFileSync(new URL("./useMechanicProgress.js", import.meta.url), "utf8");
  const renderSync = source.indexOf("valueRef.current = renderedValue;");
  const persistCallback = source.indexOf("const persist = useCallback");

  assert.ok(renderSync > 0);
  assert.ok(persistCallback > renderSync);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*valueRef\.current = normalizedMechanicProgress\(value\)/,
  );
});
