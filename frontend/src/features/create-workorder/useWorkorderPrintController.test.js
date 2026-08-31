import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrintableWorkorderForm,
  createWorkorderPrintActions,
  latestReadyWorkorderArchive,
  openBrowserPrintDialog,
  printRequestIdentity,
  printedSerialRange,
} from "./useWorkorderPrintController.js";

function formFixture(overrides = {}) {
  return {
    locationId: "location-form",
    customerCompanyName: "Long Haul",
    headerTitle: "CHINO YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    workStartDate: "2026-08-02",
    workEndDate: "2026-08-02",
    unitNo: "1018",
    unitType: "Trailer",
    mechanicConcern: "Inspect brakes",
    parts: [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }],
    privateUiState: "do not print",
    ...overrides,
  };
}

function actionHarness(overrides = {}) {
  const calls = [];
  const dependencies = {
    activeWorkorderId: "workorder-1",
    activeWorkorderLocationId: "location-workorder",
    effectiveCopies: 1,
    form: formFixture(),
    openPrintDialog: async (payload) => calls.push(["browser", payload]),
    previewSerials: ["WO-000001"],
    range: "WO-000001",
    request: async (...args) => {
      calls.push(["request", ...args]);
      return {
        downloadUrl: "/prints/workorder-1.pdf",
        serials: ["WO-000001"],
        printForm: formFixture(),
      };
    },
    setCreateState: (state) => calls.push(["create", state]),
    setPrintMenuOpen: (open) => calls.push(["menu", open]),
    setPrintState: (state) => calls.push(["state", state]),
    getIdempotencyKey: () => "print-key",
    ...overrides,
  };
  return {
    actions: createWorkorderPrintActions(dependencies),
    calls,
  };
}

test("printable form keeps the print contract and excludes UI-only state", () => {
  const printable = buildPrintableWorkorderForm(formFixture());
  assert.equal(printable.companyName, "Long Haul");
  assert.equal(printable.customerCompanyName, "Long Haul");
  assert.equal(printable.unitNo, "1018");
  assert.deepEqual(printable.parts, [{
    partNo: "FILTER",
    qty: "1",
    uomCode: "pc",
    repairOrder: "Replace",
  }]);
  assert.equal(Object.hasOwn(printable, "privateUiState"), false);
  assert.equal(Object.hasOwn(printable, "locationId"), false);
});

test("drafts are blocked before menu, browser print, or archive API work", async () => {
  const { actions, calls } = actionHarness({ activeWorkorderId: "" });
  assert.equal(await actions.printWorkorders(), false);
  assert.deepEqual(calls, [["create", {
    busy: false,
    message: "Create the workorder before printing. Drafts do not receive serial numbers.",
  }]]);
});

test("printing archives first, then browser-print renders only the returned snapshot", async () => {
  const archivedForm = formFixture({ headerTitle: "ARCHIVED SNAPSHOT" });
  const { actions, calls } = actionHarness({
    request: async (...args) => {
      calls.push(["request", ...args]);
      return { downloadUrl: "/prints/workorder-1.pdf", serials: ["WO-000001"], printForm: archivedForm };
    },
  });
  assert.equal(await actions.printWorkorders(), true);

  assert.equal(calls[0][0], "menu");
  assert.equal(calls[0][1], false);
  assert.equal(calls[1][0], "state");
  assert.equal(calls[1][1].stage, "archiving");
  assert.equal(calls[2][0], "request");
  assert.equal(calls[2][1], "/api/print");
  assert.deepEqual(calls[2][2], {
    method: "POST",
    body: JSON.stringify({
      workorderId: "workorder-1",
      locationId: "location-form",
      companyName: "Long Haul",
      count: 1,
      artifactKind: "original",
      predecessorArchiveId: null,
      revisionReason: "",
      idempotencyKey: "print-key",
    }),
  });
  assert.equal(calls[3][0], "browser");
  assert.equal(calls[3][1].form, archivedForm);
  assert.deepEqual(calls[3][1].serials, ["WO-000001"]);
  assert.deepEqual(calls.slice(4).map((call) => call[1].stage), ["printing", "done"]);
  assert.equal(calls.at(-1)[1].downloadUrl, "/prints/workorder-1.pdf");
});

test("missing archived snapshot never opens the browser print dialog", async () => {
  const { actions, calls } = actionHarness({
    request: async (...args) => {
      calls.push(["request", ...args]);
      return { downloadUrl: "/prints/workorder-1.pdf", serials: ["WO-000001"] };
    },
  });
  assert.equal(await actions.printWorkorders(), false);
  assert.equal(calls.some(([name]) => name === "browser"), false);
  assert.equal(calls.at(-1)[1].stage, "error");
});

test("retrying a failed archive post reuses the same idempotency key", async () => {
  const keys = [];
  const { actions } = actionHarness({
    request: async () => { throw new Error("network lost"); },
    getIdempotencyKey: (input) => {
      keys.push(input);
      return "actor-session-print-key";
    },
  });
  assert.equal(await actions.printWorkorders(), false);
  assert.equal(await actions.printWorkorders(), false);
  assert.deepEqual(keys, [
    { artifactKind: "original", predecessorArchiveId: null, count: 1, revisionReason: "" },
    { artifactKind: "original", predecessorArchiveId: null, count: 1, revisionReason: "" },
  ]);
});

test("idempotency identity changes for a different copy count or revision reason", () => {
  const base = { actorId: "actor-1", workorderId: "workorder-1", artifactKind: "revised", predecessorArchiveId: "archive-1", count: 1, revisionReason: "Corrected part" };
  assert.notEqual(printRequestIdentity(base), printRequestIdentity({ ...base, count: 2 }));
  assert.notEqual(printRequestIdentity(base), printRequestIdentity({ ...base, revisionReason: "Corrected mileage" }));
  assert.equal(printRequestIdentity(base), printRequestIdentity(base));
});

test("existing ready archive becomes a safe original download instead of a conflicting new original", async () => {
  const existing = {
    id: "archive-original", workorderId: "workorder-1", workorderSerial: "WO-000001",
    artifactKind: "original", status: "ready", downloadUrl: "/api/jobs/archive-original/pdf", copyCount: 1,
  };
  const { actions, calls } = actionHarness({
    findExistingArchive: async () => existing,
  });
  assert.equal(await actions.printWorkorders(), true);
  assert.equal(calls.some(([name]) => name === "request"), false);
  assert.equal(calls.some(([name]) => name === "browser"), false);
  assert.deepEqual(calls.at(-1), ["state", {
    open: true, stage: "done", message: "An archived original is ready to download.", archive: existing,
    downloadUrl: "/api/jobs/archive-original/pdf", range: "WO-000001", pageCount: 1,
  }]);
});

test("revised copy names its predecessor and browser-prints the returned revised snapshot", async () => {
  const revisedForm = formFixture({ headerTitle: "REVISED — CHINO YARD WORKORDER" });
  const { actions, calls } = actionHarness({
    request: async (...args) => {
      calls.push(["request", ...args]);
      return { downloadUrl: "/api/jobs/archive-revised/pdf", serials: ["WO-000001"], printForm: revisedForm };
    },
  });
  assert.equal(await actions.printWorkorders({ artifactKind: "revised", predecessorArchiveId: "archive-original", revisionReason: "Corrected parts" }), true);
  const body = JSON.parse(calls.find(([name]) => name === "request")[2].body);
  assert.deepEqual(body, {
    workorderId: "workorder-1", locationId: "location-form", companyName: "Long Haul", count: 1,
    artifactKind: "revised", predecessorArchiveId: "archive-original", revisionReason: "Corrected parts", idempotencyKey: "print-key",
  });
  assert.equal(calls.find(([name]) => name === "browser")[1].form, revisedForm);
});

test("returned serial and physical-page counts own the final print summary", async () => {
  const sevenParts = Array.from({ length: 7 }, (_, index) => ({
    partNo: `PART-${index + 1}`,
    qty: "1",
    uomCode: "pc",
    repairOrder: "Install",
  }));
  const { actions, calls } = actionHarness({
    effectiveCopies: 2,
    form: formFixture({ parts: sevenParts }),
    previewSerials: ["WO-000010", "WO-000011"],
    range: "WO-000010 to WO-000011",
    request: async (...args) => {
      calls.push(["request", ...args]);
      return {
        downloadUrl: "/prints/batch.pdf",
        serials: ["WO-000020", "WO-000021"],
        printForm: formFixture({ parts: sevenParts }),
      };
    },
  });

  await actions.printWorkorders();
  const states = calls.filter(([name]) => name === "state").map(([, state]) => state);
  assert.equal(states[0].pageCount, 4);
  assert.equal(states.at(-1).range, "WO-000020 to WO-000021");
  assert.equal(states.at(-1).pageCount, 4);
  const requestBody = JSON.parse(calls.find(([name]) => name === "request")[2].body);
  assert.equal(requestBody.count, 2);
});

test("archive failures become print errors without changing the preserved page count", async () => {
  const { actions, calls } = actionHarness({
    request: async () => { throw new Error("Archive unavailable."); },
  });
  assert.equal(await actions.printWorkorders(), false);
  assert.deepEqual(calls.at(-1), ["state", {
    open: true,
    stage: "error",
    message: "Archive unavailable.",
    pageCount: 1,
  }]);
});

test("mechanic print progress is localized and hides provider failure details", async () => {
  const { actions, calls } = actionHarness({
    locale: "es",
    request: async () => { throw new Error("provider stack detail"); },
  });
  assert.equal(await actions.printWorkorders(), false);
  const states = calls.filter(([name]) => name === "state").map(([, state]) => state);
  assert.equal(states[0].message, "Guardando una copia PDF archivada.");
  assert.equal(states.at(-1).message, "No se pudo imprimir. Inténtalo de nuevo.");
  assert.doesNotMatch(states.at(-1).message, /provider/i);
});

test("browser print waits two frames and font readiness before opening the dialog", async () => {
  const calls = [];
  await openBrowserPrintDialog({
    payload: { form: {}, serials: ["WO-1"] },
    setBrowserPrintPayload: (payload) => calls.push(["payload", payload]),
    scheduleFrame: (callback) => {
      calls.push(["frame"]);
      callback();
    },
    fontsReady: Promise.resolve().then(() => calls.push(["fonts"])),
    printBrowser: () => calls.push(["print"]),
  });
  assert.deepEqual(calls.map(([name]) => name), ["payload", "frame", "frame", "fonts", "print"]);
});

test("serial range uses one serial, a bounded range, or the caller fallback", () => {
  assert.equal(printedSerialRange(["WO-1"], "DRAFT"), "WO-1");
  assert.equal(printedSerialRange(["WO-1", "WO-3"], "DRAFT"), "WO-1 to WO-3");
  assert.equal(printedSerialRange([], "WO-OLD"), "WO-OLD");
});

test("original archive lookup never substitutes a newer revision", () => {
  const archive = latestReadyWorkorderArchive([
    { id: "other", workorderId: "other-workorder", artifactKind: "original", status: "ready", downloadUrl: "/pdf", createdAt: "2026-08-31" },
    { id: "failed", workorderId: "workorder-1", artifactKind: "original", status: "failed", downloadUrl: "/pdf", createdAt: "2026-08-31" },
    { id: "latest", workorderId: "workorder-1", artifactKind: "revised", status: "ready", downloadUrl: "/pdf/latest", createdAt: "2026-08-31T02:00:00Z" },
    { id: "older", workorderId: "workorder-1", artifactKind: "original", status: "ready", downloadUrl: "/pdf/older", createdAt: "2026-08-31T01:00:00Z" },
  ], "workorder-1");
  assert.equal(archive.id, "older");
});

test("controller rejects missing API and browser-print dependencies", () => {
  assert.throws(() => createWorkorderPrintActions({
    request: null,
    openPrintDialog: async () => {},
  }), /request must be a function/);
  assert.throws(() => createWorkorderPrintActions({
    request: async () => ({}),
    openPrintDialog: null,
  }), /openPrintDialog must be a function/);
});
