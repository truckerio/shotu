import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./unit/UnitServiceHistory.jsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./unit/useUnitServiceHistory.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./unit/unit-service-history.css", import.meta.url), "utf8");
const unit = readFileSync(new URL("./unit/WorkorderUnitModule.jsx", import.meta.url), "utf8");

test("unit history stays inside the Unit module as native progressive disclosure", () => {
  assert.match(unit, /<UnitServiceHistory actorRole=\{actorRole\} historyController=\{historyController\} workorderId=/);
  assert.match(panel, /<details[\s\S]*className="unit-service-history"/);
  assert.match(panel, /<summary className="unit-service-history-summary">/);
  assert.match(panel, /<span className="unit-service-history-summary-copy">/);
  assert.match(unit, /historyController/);
  assert.doesNotMatch(panel, /View history|Hide history/);
  assert.doesNotMatch(panel, /aria-controls="unit-service-history-list"/);
  assert.match(panel, /Show more/);
  assert.match(panel, /import \{ WorkorderTimelineList \} from "\.\.\/\.\.\/\.\.\/components\/workorders\/WorkorderTimeline\.jsx"/);
  assert.match(panel, /<WorkorderTimelineList items=\{history\.items\.map\(serviceRecordTimelineItem\)\}/);
  assert.doesNotMatch(panel, /unit-service-history-record(?:s|-heading)?/);
  assert.doesNotMatch(css, /unit-service-history-record(?:s|-heading)?/);
  assert.match(panel, /open=\{expanded\}/);
  assert.match(panel, /onToggle=\{\(event\) => setExpanded\(event\.currentTarget\.open\)\}/);
  assert.match(panel, /actorRole === "admin"/);
  assert.match(panel, /error \|\| \["unlinked", "never_synced", "stale", "unavailable"\]/);
  assert.match(panel, /Open integration settings/);
  assert.match(hook, /expanded, setExpanded/);
  assert.doesNotMatch(panel, /onApply|onFieldChange|set.*(?:diagnosis|workPerformed)/);
});

test("history fetch is bounded, cancellable, and stale-safe", () => {
  assert.match(hook, /limit: "10"/);
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /requestSequence/);
  assert.match(hook, /controllerRef\.current\?\.abort\(\)/);
  assert.match(hook, /timeoutMs: 12000/);
});

test("stale records render one warning without replacing retained history", () => {
  assert.match(panel, /showBlockingState = history\?\.state !== "ready" && !\(history\?\.state === "stale" && canShowRecords\)/);
  assert.match(panel, /history\.state === "stale" \? <div className="unit-service-history-state is-warning"/);
});

test("phone actions meet the 44px target", () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.unit-service-history button \{ min-height: 44px/);
});
