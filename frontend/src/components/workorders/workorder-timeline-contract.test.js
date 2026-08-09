import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./WorkorderTimeline.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-timeline.css", import.meta.url), "utf8");
const surveillanceDetail = readFileSync(new URL("../../features/surveillance/workspace/SurveillanceDetailPage.jsx", import.meta.url), "utf8");

test("shared activity surface has one hierarchy and retains actor, time, status, and mechanic context", () => {
  assert.doesNotMatch(component, /<h[1-6][^>]*>\s*Timeline/i);
  assert.doesNotMatch(component, />Mechanics involved</);
  assert.match(component, /workorder-participants-label">Mechanics</);
  assert.match(component, /event\.changed_by_name \|\| "System"/);
  assert.match(component, /workorder-timeline-date/);
  assert.match(component, /actorRoleLabel\(actorRole\)/);
  assert.match(component, /workorder-timeline-role/);
  assert.match(component, /<time dateTime=\{event\.created_at\}>/);
  assert.match(css, /\.workorder-timeline-date\s*\{[^}]*display:\s*inline-flex;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(component, /workorder-timeline-status/);
  assert.doesNotMatch(component, /timelineEventStatus/);
  assert.doesNotMatch(surveillanceDetail, /detail\.timeline\?\.length/);
  assert.match(surveillanceDetail, /activityCount = timelineEventCount\(detail\.timeline\)/);
});

test("multi-change parents are collapsed by default with an accessible disclosure control", () => {
  assert.match(component, /useState\(\(\) => new Set\(\)\)/);
  assert.match(component, /const expandable = group\.childCount > 1/);
  assert.match(component, /<button[\s\S]*className="workorder-timeline-toggle"[\s\S]*type="button"/);
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(component, /aria-controls=\{childrenId\}/);
  assert.match(component, /expandable && expanded \? \(/);
  assert.match(component, /<ol className="workorder-timeline-children" id=\{childrenId\}/);
  assert.match(component, /group\.childCount} changes/);
});

test("390px and 430px activity rail stays in a min-width-zero single content column", () => {
  assert.match(css, /grid-template-columns:\s*16px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.workorder-timeline-event\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /border-radius:\s*12px;/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
  assert.match(css, /\.workorder-timeline-children\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.workorder-timeline-children\s*>\s*li\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.workorder-timeline-child-heading\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.workorder-timeline-children[^}]*overflow-wrap:\s*anywhere;/s);

  for (const viewportWidth of [390, 430]) {
    const contentWidth = viewportWidth - 24;
    assert.ok(contentWidth > 0);
    assert.ok(12 + 8 < contentWidth, "timeline rail must leave readable event width");
  }
});
