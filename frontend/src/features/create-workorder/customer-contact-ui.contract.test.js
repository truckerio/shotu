import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const section = readFileSync(new URL("./CustomerDirectoryField.jsx", import.meta.url), "utf8");
const approval = readFileSync(new URL("./ApprovalRequestControl.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./CreateWorkorderPage.jsx", import.meta.url), "utf8");

test("customer details use the canonical Customer row and compact directory selection", () => {
  assert.match(section, /<CustomerCompanyField/);
  assert.match(section, /hint=""/);
  assert.doesNotMatch(section, /Customer name on this Workorder/);
  assert.match(section, /<UnitDetailsPopover title="Customer details" open=\{detailsOpen\} onToggle=\{setDetailsOpen\}/);
  assert.match(section, /customerCompanyName\.trim\(\) \|\| "Select customer"/);
  assert.match(section, /className="customer-directory-customer"/);
  assert.match(section, /className="customer-directory-contact"/);
  assert.match(section, /className="customer-directory-address"/);
  assert.match(section, /customerContactEmail/);
  assert.match(section, /customerAddress/);
  assert.match(section, /onUnmatchedDetailsChange/);
  assert.match(section, /<label className="customer-directory-address">Address<output>\{customer\?\.address \|\| "—"\}<\/output><\/label>/);
  assert.doesNotMatch(section, /<header>/);
  assert.doesNotMatch(section, /Select, create, or update/);
  assert.match(section, /customerDirectorySelectionState/);
  assert.match(section, /directoryState\.kind !== "available_match"/);
  assert.match(section, /customerSelectionPatch\(\{[\s\S]*?customer: directoryState\.customer/);
  assert.doesNotMatch(section, /Typed customer name is not linked to the directory/);
  assert.doesNotMatch(section, /Select it above to link this Workorder/);
  assert.doesNotMatch(section, /role="status"/);
  assert.doesNotMatch(section, /New customer|Edit customer|New contact|Edit contact/);
  assert.doesNotMatch(section, /onCreateCustomer|onEditCustomer|onCreateContact|onEditContact/);
});

test("the unified customer field retains Samsara unit customer suggestions", () => {
  assert.match(section, /suggestions=\{suggestions\}/);
  assert.match(section, /suggestionsLabel=\{suggestionsLabel\}/);
  assert.match(page, /normalizedVehicleTagNames\(selectedVehicle\?\.tag_names \|\| selectedVehicle\?\.tagNames\)/);
  assert.match(page, /suggestions=\{vehicleCustomerSuggestions\}/);
  assert.match(page, /suggestionsLabel=\{t\("create\.unit\.vehicleTags"\)\}/);
});

test("approval is an explicit opt-in rather than a default external-approval demand", () => {
  assert.match(approval, /<Checkbox/);
  assert.match(approval, /Ask for customer approval/);
  assert.match(approval, /aria-label="Customer approval"/);
  assert.doesNotMatch(approval, /<h2/);
  assert.doesNotMatch(approval, /<p>/);
});

test("customer details popover remains controlled and has no button-based directory flow", () => {
  assert.doesNotMatch(section, /open=\{false\}/);
  assert.match(section, /open=\{detailsOpen\} onToggle=\{setDetailsOpen\}/);
  assert.doesNotMatch(section, /<button/);
});
