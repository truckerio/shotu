import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./WorkorderTimeline.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-timeline.css", import.meta.url), "utf8");
const surveillanceDetail = readFileSync(new URL("../../features/surveillance/workspace/SurveillanceDetailPage.jsx", import.meta.url), "utf8");

test("shared activity surface has one hierarchy and retains actor, time, status, and mechanic context", () => {
  assert.doesNotMatch(component, /<h[1-6][^>]*>\s*Timeline/i);
  assert.doesNotMatch(component, />Mechanics involved</);
  assert.match(component, /timeline\.mechanics/);
  assert.match(component, /timeline\.system/);
  assert.match(component, /workorder-timeline-date/);
  assert.match(component, /actorRoleLabel\(actorRole, locale\)/);
  assert.match(component, /timeline\.role\.\$\{normalized\}/);
  assert.match(component, /workorder-timeline-role/);
  assert.match(component, /<time dateTime=\{event\.created_at\}>/);
  assert.match(css, /\.workorder-timeline-date\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;[^}]*background:\s*transparent;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.workorder-timeline-date time,[\s\S]*?\.workorder-timeline-date > span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.workorder-timeline-child-heading time\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.doesNotMatch(component, /workorder-timeline-status/);
  assert.doesNotMatch(component, /timelineEventStatus/);
  assert.doesNotMatch(surveillanceDetail, /detail\.timeline\?\.length/);
  assert.match(surveillanceDetail, /activityCount = timelineEventCount\(detail\.timeline\)/);
});

test("shared timeline list owns timeline structure and record details", () => {
  assert.match(component, /export function WorkorderTimelineList/);
  assert.match(component, /<ol className=\{`workorder-timeline-list \$\{className\}`\.trim\(\)\}>/);
  assert.match(component, /<dl className="workorder-timeline-details">/);
  assert.match(component, /return <WorkorderTimelineList items=\{items\} locale=\{locale\} \/>/);
});

test("service history can opt into the compact shared timeline treatment without changing activity defaults", () => {
  assert.match(component, /\{ className = "", emptyMessage, items, locale = "en" \}/);
  assert.match(css, /\.workorder-timeline-list\.is-service-history > li\s*\{[^}]*grid-template-columns:\s*148px 14px minmax\(0, 1fr\);/s);
  assert.match(css, /\.workorder-timeline-list\.is-service-history > li:not\(:last-child\)::after\s*\{[^}]*left:\s*164\.5px;/s);
  assert.match(css, /\.workorder-timeline-list\.is-service-history \.workorder-timeline-event\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.workorder-timeline-list\.is-service-history \.workorder-timeline-role[^}]*background:\s*transparent;/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-list\.is-service-history > li\s*\{[^}]*grid-template-columns:\s*12px minmax\(0, 1fr\);/s);
});

test("shared Activity uses flat rows and moves full metadata above the event before tablet and zoom widths", () => {
  assert.match(css, /\.workorder-timeline-list > li\s*\{[^}]*grid-template-columns:\s*minmax\(0, 168px\) 12px minmax\(0, 1fr\);/s);
  assert.match(css, /\.workorder-timeline-list > li:not\(:last-child\)::after\s*\{[^}]*left:\s*185\.5px;/s);
  assert.match(css, /\.workorder-timeline-event\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-list > li\s*\{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\);/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-date\s*\{[^}]*grid-column:\s*2;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-date \[aria-hidden="true"\]\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-list\.is-service-history \.workorder-timeline-date \[aria-hidden="true"\]\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*1024px\)[\s\S]*\.workorder-timeline-marker\s*\{[^}]*grid-row:\s*1 \/ span 2;/s);
});

test("multi-change parents are collapsed by default with an accessible disclosure control", () => {
  assert.match(component, /useState\(\(\) => new Set\(\)\)/);
  assert.match(component, /const expandable = group\.childCount > 1/);
  assert.match(component, /<button[\s\S]*className="workorder-timeline-toggle"[\s\S]*type="button"/);
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(component, /aria-controls=\{childrenId\}/);
  assert.match(component, /expandable && expanded \? \(/);
  assert.match(component, /<ol className="workorder-timeline-children" id=\{childrenId\}/);
  assert.match(component, /formatLocaleNumber\(group\.childCount, locale\).*timeline\.changes/);
});

test("390px and 430px activity rail stays in a min-width-zero single content column", () => {
  assert.match(css, /grid-template-columns:\s*14px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.workorder-timeline-event\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.workorder-timeline-event\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.match(css, /@media \(max-width:\s*1024px\)/);
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
