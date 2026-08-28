import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServiceHistoryResponse, serviceHistoryDateLabel, serviceHistorySourceLabel, serviceHistoryStatus, serviceHistorySummaryLabel } from "./unit/service-history-model.js";

test("normalizes a tolerant history response without turning unavailable into empty", () => {
  const history = normalizeServiceHistoryResponse({ state: "unavailable", summary: { historyCount: "7" }, freshness: { warning: "Odoo has not responded" }, items: [] });
  assert.equal(history.state, "unavailable");
  assert.equal(history.summary.historyCount, 7);
  assert.equal(serviceHistoryStatus(history).title, "Service history is unavailable");
  assert.equal(serviceHistorySummaryLabel(history), "Service history is unavailable");

  assert.equal(normalizeServiceHistoryResponse({ state: "provider_error", items: [] }).state, "unavailable");
});

test("mechanic-safe status hides provider diagnostics behind localized text", () => {
  const history = normalizeServiceHistoryResponse({ state: "stale", freshness: { warning: "Odoo timeout: provider detail" } });
  assert.equal(serviceHistoryStatus(history, "es").message, "Se muestra el historial de servicio más reciente disponible.");
  assert.equal(serviceHistoryStatus(history, "en", { includeDiagnostic: true }).message, "Odoo timeout: provider detail");
});

test("normalizes records and uses last completed service for compact context", () => {
  const history = normalizeServiceHistoryResponse({
    state: "ready",
    summary: { historyCount: 2, lastCompletedServiceAt: "2026-07-18T00:00:00.000Z" },
    items: [{ id: 9, reference: "S00123", dateKind: "verified_completed", work_performed: " Replaced hub seal ", serviceLines: [" Inspect hub ", ""], parts: [{ description: "Hub seal", qty: 1 }], truncated: { serviceLines: true } }],
    nextCursor: "next-page",
  });
  assert.equal(history.items[0].workPerformed, "Replaced hub seal");
  assert.equal(history.items[0].parts[0].name, "Hub seal");
  assert.deepEqual(history.items[0].serviceLines, ["Inspect hub"]);
  assert.equal(serviceHistoryDateLabel(history.items[0].dateKind), "Completed");
  assert.equal(history.items[0].truncated.serviceLines, true);
  assert.equal(history.items[0].truncated.parts, false);
  assert.equal(history.nextCursor, "next-page");
  assert.match(serviceHistorySummaryLabel(history), /^Last completed service/);
});

test("keeps missing record and part labels empty for locale-aware rendering", () => {
  const history = normalizeServiceHistoryResponse({ state: "ready", items: [{ parts: [{}] }] });
  assert.equal(history.items[0].reference, "");
  assert.equal(history.items[0].parts[0].name, "");
});

test("does not label a recorded-only date as completed", () => {
  const history = normalizeServiceHistoryResponse({
    state: "ready",
    summary: { latestRecordedServiceAt: "2026-07-10T00:00:00.000Z" },
    items: [],
  });
  assert.match(serviceHistorySummaryLabel(history), /^Latest service record/);
  assert.doesNotMatch(serviceHistorySummaryLabel(history), /completed/i);
});

test("uses plain-language labels for provider and local history sources", () => {
  assert.equal(serviceHistorySourceLabel("odoo"), "Odoo service order");
  assert.equal(serviceHistorySourceLabel("local"), "Local workorder");
});
