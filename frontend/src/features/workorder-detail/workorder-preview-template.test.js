import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDetailPreviewTemplate } from "./workorder-preview-template.js";

test("current workorder location replaces stale saved Preview heading", () => {
  const savedForm = { headerTitle: "NEW JERSEY YARD WORKORDER" };
  const canonical = canonicalDetailPreviewTemplate({
    locationId: "chino",
    location: { id: "chino", name: "Chino Yard" },
    formData: savedForm,
  });

  assert.deepEqual(
    { ...savedForm, ...canonical },
    { headerTitle: "CHINO YARD WORKORDER" },
  );
});

test("current location template wins when its canonical template is loaded", () => {
  const canonical = canonicalDetailPreviewTemplate(
    { locationId: "chino", location: { id: "chino", name: "Chino Yard" } },
    [{
      location: { id: "chino", name: "Chino Yard" },
      template: {
        header_title: "CHINO SERVICE WORKORDER",
        brand_top: "CURRENT BRAND",
        brand_bottom: "REPAIR",
        warranty_text: "Current warranty",
        responsibility_text: "Current responsibility",
        authorization_text: "Current authorization",
      },
    }],
  );

  assert.equal(canonical.headerTitle, "CHINO SERVICE WORKORDER");
  assert.equal(canonical.brandTop, "CURRENT BRAND");
});
