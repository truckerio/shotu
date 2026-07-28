import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./WorkorderTimeline.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-timeline.css", import.meta.url), "utf8");
const surveillance = readFileSync(new URL("../../features/surveillance/SurveillanceWorkspace.jsx", import.meta.url), "utf8");

test("shared activity surface has one hierarchy and retains actor, time, status, and mechanic context", () => {
  assert.doesNotMatch(component, /<h[1-6][^>]*>\s*Timeline/i);
  assert.doesNotMatch(component, />Mechanics involved</);
  assert.match(component, /workorder-participants-label">Mechanics</);
  assert.match(component, /event\.changed_by_name \|\| "System"/);
  assert.match(component, /workorder-timeline-date" dateTime=\{event\.created_at\}/);
  assert.match(component, /timelineEventStatus\(event\)/);
  assert.doesNotMatch(surveillance, /detail\.timeline\?\.length/);
  assert.match(surveillance, /activityCount = timelineEventCount\(detail\.timeline\)/);
});

test("390px and 430px activity rail stays in a min-width-zero single content column", () => {
  assert.match(css, /grid-template-columns:\s*16px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.workorder-timeline-event\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /border-radius:\s*12px;/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.match(css, /@media \(max-width:\s*640px\)/);

  for (const viewportWidth of [390, 430]) {
    const contentWidth = viewportWidth - 24;
    assert.ok(contentWidth > 0);
    assert.ok(12 + 8 < contentWidth, "timeline rail must leave readable event width");
  }
});
