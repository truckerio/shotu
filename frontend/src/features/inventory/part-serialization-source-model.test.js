import assert from "node:assert/strict";
import test from "node:test";
import { serializedUnitSourceView } from "./part-serialization-source-model.js";

test("invoice source shows reviewed identity and links to the exact intake run", () => {
  assert.deepEqual(serializedUnitSourceView({
    type: "invoice",
    id: "00000000-0000-4000-8000-000000000501",
    vendorName: "QA Serial Parts",
    invoiceNumber: "QA-INV-501",
    fileName: "qa-invoice.pdf",
  }), {
    label: "Invoice receipt",
    details: "QA Serial Parts · QA-INV-501",
    href: "/?adminView=inventory&view=inventory&invoiceRun=00000000-0000-4000-8000-000000000501",
  });
});

test("invoice source falls back to its file while non-invoice sources stay unlinked", () => {
  assert.deepEqual(serializedUnitSourceView({
    type: "invoice",
    id: "00000000-0000-4000-8000-000000000502",
    fileName: "fallback-invoice.png",
  }), {
    label: "Invoice receipt",
    details: "fallback-invoice.png",
    href: "/?adminView=inventory&view=inventory&invoiceRun=00000000-0000-4000-8000-000000000502",
  });
  assert.deepEqual(serializedUnitSourceView({ type: "manual", id: "batch-1" }), {
    label: "Added manually",
    details: "",
    href: "",
  });
});
