import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

test("PartRequestsPanel only dispatches role-owned surfaces", () => {
  const panel = source("../PartRequestsPanel.jsx");
  assert.ok(panel.split("\n").length < 100);
  assert.match(panel, /<MechanicPartsSurface/);
  assert.match(panel, /<OfficePartsSurface/);
  assert.match(panel, /<ReadOnlyPartsSurface/);
  assert.doesNotMatch(panel, /api\(|useState|QuantityUnitInput|NarrativeField/);
});

test("role surfaces keep permissions and endpoints with their owners", () => {
  const mechanicSurface = source("./MechanicPartsSurface.jsx");
  const mechanicCard = source("./MechanicRequestCard.jsx");
  const officeSurface = source("./OfficePartsSurface.jsx");
  const officeComposer = source("./OfficePartComposer.jsx");
  const officeReview = source("./useOfficeRequestReview.js");

  assert.match(mechanicSurface, /mechanicPartsActionState\(detail\.allowedActions/);
  assert.match(mechanicSurface, /<MechanicPartRequestForm/);
  assert.doesNotMatch(mechanicCard, /\/api\/mechanic\/|<Dropdown/);
  assert.match(officeSurface, /detail\.allowedActions\?\.planParts \? \(/);
  assert.doesNotMatch(officeSurface, /addApprovedParts/);
  assert.match(officeComposer, /\/api\/office\/workorders\/\$\{detail\.workorder\.id\}\/part-plans/);
  assert.match(officeReview, /\/api\/office\/workorders\/\$\{detail\.workorder\.id\}\/parts\/\$\{request\.id\}\/decision/);
  assert.match(officeReview, /\/api\/parts-helper\/identify/);
  assert.match(officeReview, /\/api\/parts-helper\/live-prices/);
  assert.match(officeReview, /catalogPartId:\s*part\.id/);
  assert.match(officeReview, /inventoryItemId:\s*part\.inventory\.itemId/);
});

test("quantity and supply controls remain shared implementations", () => {
  const allocation = source("./AllocationEditor.jsx");
  const officeCard = source("./OfficeRequestCard.jsx");
  const composer = source("./OfficePartComposer.jsx");

  assert.match(allocation, /<AnchoredSelect/);
  assert.match(allocation, /<QuantityUnitInput/);
  assert.match(officeCard, /<QuantityUnitInput/);
  assert.match(officeCard, /<PartCatalogCombobox/);
  assert.match(officeCard, /onSelect=\{review\.selectCatalogPart\}/);
  assert.match(composer, /<QuantityUnitInput/);
  assert.doesNotMatch(allocation, /const\s+UNITS_OF_MEASURE/);
});

test("office planning capability remains a focused, reusable owner", () => {
  const composer = source("./OfficePartComposer.jsx");
  const surface = source("./OfficePartsSurface.jsx");
  assert.match(composer, /export function OfficePartComposer/);
  assert.match(composer, /\/api\/office\/workorders\/\$\{detail\.workorder\.id\}\/part-plans/);
  assert.doesNotMatch(composer, /t\("parts\.planningDoesNotRecordUse"\)/);
  assert.match(surface, /<SectionHelpDisclosure label=\{t\("parts\.planningDoesNotRecordUse"\)\}>/);
  assert.match(composer, /await onChanged\(\)/);
});
