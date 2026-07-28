import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAllocationFeedback,
  formatPartDecisionFeedback,
  formatUsageFeedback,
  partRequestLabel,
} from "./part-feedback.js";

test("part decision feedback explains approval and supply", () => {
  assert.equal(
    formatPartDecisionFeedback({
      decision: "approved",
      quantity: 2,
      label: "LF9009",
      reason: "Use the filters in bin B-12",
      allocations: [{ sourceType: "inventory", status: "reserved" }],
    }),
    "Office approved 2 ea LF9009. Supply: inventory (Reserved). Use the filters in bin B-12."
  );
});

test("part decision feedback makes a clarification actionable", () => {
  assert.equal(
    formatPartDecisionFeedback({
      decision: "needs_info",
      quantity: 1,
      label: "fuel filter",
      reason: "Send a photo of the existing filter",
    }),
    "Office needs more information for 1 ea fuel filter. Send a photo of the existing filter."
  );
});

test("allocation and usage feedback use readable status labels", () => {
  assert.equal(
    formatAllocationFeedback({
      quantity: 1,
      label: "A83911",
      sourceType: "purchase",
      status: "ordered",
      note: "",
    }),
    "Part update: 1 ea A83911 from purchase is now Ordered."
  );
  assert.equal(
    formatUsageFeedback({
      quantity: 1,
      label: "A83911",
      usageStatus: "partially_installed",
      note: "Waiting for a second seal",
    }),
    "Mechanic marked 1 ea A83911 as Partially Installed. Waiting for a second seal."
  );
});

test("measured quantities keep their unit in feedback", () => {
  assert.equal(
    formatPartDecisionFeedback({
      decision: "approved",
      quantity: 2.375,
      uomCode: "gal",
      label: "engine oil",
    }),
    "Office approved 2.375 gal engine oil."
  );
});

test("part request label follows the durable identifier priority", () => {
  assert.equal(partRequestLabel({ part_number: "LF9009", description: "Filter" }), "LF9009");
  assert.equal(partRequestLabel({ description: "Filter" }), "Filter");
  assert.equal(partRequestLabel({ raw_query: "Need filter" }), "Need filter");
});
