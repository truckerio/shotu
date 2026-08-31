import { useCallback, useMemo, useRef, useState } from "react";

import { workorderPhysicalPageCount } from "../../../../shared/workorder-template.js";
import { interfaceText } from "../../i18n/index.js";

export const INITIAL_PRINT_STATE = Object.freeze({
  open: false,
  stage: "idle",
  message: "",
});

const PRINTABLE_FORM_FIELDS = Object.freeze([
  "headerTitle",
  "brandTop",
  "brandBottom",
  "warrantyText",
  "responsibilityText",
  "authorizationText",
  "workDate",
  "workStartDate",
  "workEndDate",
  "unitNo",
  "unitType",
  "licenseNo",
  "mileage",
  "model",
  "vinNo",
  "mechanicConcern",
  "mechanicName",
  "startTime",
  "endTime",
  "managerName",
  "customerSignature",
  "authorizedBy",
  "parts",
]);

function positivePrintCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

export function printRequestIdentity({ actorId, workorderId, artifactKind, predecessorArchiveId, count, revisionReason }) {
  const payload = `${actorId || "session"}:${workorderId}:${artifactKind}:${predecessorArchiveId || ""}:${count}:${revisionReason || ""}`;
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${actorId || "session"}:${workorderId}:${artifactKind}:${predecessorArchiveId || ""}:${count}:${(hash >>> 0).toString(36)}`;
}

function printKeyStorageName(input) {
  return ["workorder-print", printRequestIdentity(input)].join(":");
}

export function latestReadyWorkorderArchive(jobs, workorderId) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.workorderId === workorderId
      && job.artifactKind === "original"
      && job.status === "ready"
      && job.downloadUrl)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
}

export function buildPrintableWorkorderForm(form = {}) {
  const printableForm = {
    companyName: form.customerCompanyName,
    customerCompanyName: form.customerCompanyName,
  };
  for (const field of PRINTABLE_FORM_FIELDS) printableForm[field] = form[field];
  return printableForm;
}

export function printedSerialRange(serials, fallbackRange = "") {
  if (!Array.isArray(serials) || serials.length === 0) return fallbackRange;
  return serials.length === 1 ? serials[0] : `${serials[0]} to ${serials.at(-1)}`;
}

export async function openBrowserPrintDialog({
  payload,
  setBrowserPrintPayload,
  scheduleFrame = (callback) => requestAnimationFrame(callback),
  fontsReady = typeof document === "undefined" ? null : document.fonts?.ready,
  printBrowser = () => window.print(),
}) {
  setBrowserPrintPayload(payload);
  await new Promise((resolve) => scheduleFrame(() => scheduleFrame(resolve)));
  if (fontsReady) await fontsReady;
  printBrowser();
}

export function createWorkorderPrintActions({
  activeWorkorderId,
  activeWorkorderLocationId,
  effectiveCopies = 1,
  form,
  openPrintDialog,
  previewSerials,
  range,
  request,
  setCreateState,
  setPrintMenuOpen,
  setPrintState,
  getIdempotencyKey = () => `print-${crypto.randomUUID()}`,
  findExistingArchive = null,
  getKnownArchive = () => null,
  onArchivePersisted = () => {},
  locale = "en",
}) {
  if (typeof request !== "function") throw new TypeError("request must be a function");
  if (typeof openPrintDialog !== "function") throw new TypeError("openPrintDialog must be a function");

  const t = (key) => interfaceText(locale, key);
  return {
    async printWorkorders({ artifactKind = "original", predecessorArchiveId = null, revisionReason = "" } = {}) {
      if (!activeWorkorderId) {
        setCreateState?.({
          busy: false,
          message: t("preview.createBeforePrint"),
        });
        return false;
      }

      const count = positivePrintCount(effectiveCopies);
      const pageCount = count * workorderPhysicalPageCount(form);

      try {
        setPrintMenuOpen(false);
        setPrintState({
          open: true,
          stage: "archiving",
          message: t("preview.savingArchive"),
          range,
          pageCount,
        });

        const knownArchive = getKnownArchive();
        if (artifactKind === "original" && !knownArchive?.canBrowserReprint && typeof findExistingArchive === "function") {
          const existingArchive = await findExistingArchive();
          if (existingArchive) {
            onArchivePersisted(existingArchive, false);
            setPrintState({
              open: true,
              stage: "done",
              message: t("preview.existingArchiveReady"),
              archive: existingArchive,
              downloadUrl: existingArchive.downloadUrl,
              range: existingArchive.workorderSerial || range,
              pageCount: (existingArchive.copyCount || count) * workorderPhysicalPageCount(form),
            });
            return true;
          }
        }

        const result = await request("/api/print", {
          method: "POST",
          body: JSON.stringify({
            workorderId: activeWorkorderId,
            locationId: form.locationId || activeWorkorderLocationId || null,
            companyName: form.customerCompanyName,
            count,
            artifactKind,
            predecessorArchiveId,
            revisionReason,
            idempotencyKey: getIdempotencyKey({ artifactKind, predecessorArchiveId, count, revisionReason }),
          }),
        });
        const serials = Array.isArray(result.serials) ? result.serials : [];
        if (!result.printForm || serials.length === 0) {
          throw new Error("The archived print snapshot is unavailable. Try again.");
        }
        const archivePrintForm = result.printForm;
        // A later click uses the immutable archived download. Re-posting an edited form
        // as an "original" would correctly conflict, but would be a misleading reprint UX.
        onArchivePersisted(result.archive || null, false);
        await openPrintDialog({ form: archivePrintForm, serials });
        const resolvedRange = printedSerialRange(serials, range);
        const resolvedPageCount = (serials.length || count)
          * workorderPhysicalPageCount(archivePrintForm);
        const commonState = {
          open: true,
          downloadUrl: result.downloadUrl,
          archive: result.archive || null,
          range: resolvedRange,
          pageCount: resolvedPageCount,
        };

        setPrintState({
          ...commonState,
          stage: "printing",
          message: t("preview.openingPrintDialog"),
        });
        setPrintState({
          ...commonState,
          stage: "done",
          message: t("preview.printDialogClosed"),
        });
        return true;
      } catch (error) {
        setPrintState({
          open: true,
          stage: "error",
          message: locale === "en" && error instanceof Error ? error.message : t("preview.printFailedMessage"),
          pageCount,
        });
        return false;
      }
    },
  };
}

export function useWorkorderPrintController({
  activeWorkorderId,
  activeWorkorderLocationId,
  effectiveCopies = 1,
  form,
  previewSerials,
  range,
  request,
  setCreateState,
  scheduleFrame,
  fontsReady,
  printBrowser,
  locale = "en",
  actorId = "",
}) {
  const [printState, setPrintState] = useState(INITIAL_PRINT_STATE);
  const [browserPrintPayload, setBrowserPrintPayload] = useState(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const idempotencyKeysRef = useRef(new Map());
  const knownArchiveRef = useRef(null);
  const getIdempotencyKey = useCallback(({ artifactKind, predecessorArchiveId, count, revisionReason }) => {
    const identity = printRequestIdentity({ actorId, workorderId: activeWorkorderId, artifactKind, predecessorArchiveId, count, revisionReason });
    if (!idempotencyKeysRef.current.has(identity)) {
      const storageName = printKeyStorageName({ actorId, workorderId: activeWorkorderId, artifactKind, predecessorArchiveId, count, revisionReason });
      let stored = "";
      try { stored = window.sessionStorage.getItem(storageName) || ""; } catch { /* in-memory retry remains available */ }
      const next = stored || `print-${crypto.randomUUID()}`;
      try { window.sessionStorage.setItem(storageName, next); } catch { /* in-memory retry remains available */ }
      idempotencyKeysRef.current.set(identity, next);
    }
    return idempotencyKeysRef.current.get(identity);
  }, [actorId, activeWorkorderId]);

  const openPrintDialog = useCallback((payload) => openBrowserPrintDialog({
    payload,
    setBrowserPrintPayload,
    scheduleFrame,
    fontsReady,
    printBrowser,
  }), [fontsReady, printBrowser, scheduleFrame]);

  const findExistingArchive = useCallback(async () => {
    const result = await request(`/api/workorders/${encodeURIComponent(activeWorkorderId)}/print-archives?artifactKind=original`);
    return result?.archive || null;
  }, [activeWorkorderId, request]);

  const onArchivePersisted = useCallback((archive, canBrowserReprint) => {
    knownArchiveRef.current = archive ? { archive, canBrowserReprint } : null;
  }, []);

  const actions = useMemo(() => createWorkorderPrintActions({
    activeWorkorderId,
    activeWorkorderLocationId,
    effectiveCopies,
    form,
    openPrintDialog,
    previewSerials,
    range,
    request,
    setCreateState,
    setPrintMenuOpen,
    setPrintState,
    getIdempotencyKey,
    findExistingArchive,
    getKnownArchive: () => knownArchiveRef.current,
    onArchivePersisted,
    locale,
  }), [
    activeWorkorderId,
    activeWorkorderLocationId,
    effectiveCopies,
    form,
    openPrintDialog,
    previewSerials,
    range,
    request,
    getIdempotencyKey,
    findExistingArchive,
    locale,
    onArchivePersisted,
    setCreateState,
  ]);

  const closePrintState = useCallback(() => setPrintState(INITIAL_PRINT_STATE), []);
  const togglePrintMenu = useCallback(() => setPrintMenuOpen((open) => !open), []);

  return {
    browserPrintPayload,
    closePrintState,
    printMenuOpen,
    printState,
    printWorkorders: actions.printWorkorders,
    printRevisedCopy: (predecessorArchiveId, revisionReason) => actions.printWorkorders({ artifactKind: "revised", predecessorArchiveId, revisionReason }),
    setPrintMenuOpen,
    setPrintState,
    togglePrintMenu,
  };
}
