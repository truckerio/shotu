import { useCallback, useMemo, useState } from "react";

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
  locale = "en",
}) {
  if (typeof request !== "function") throw new TypeError("request must be a function");
  if (typeof openPrintDialog !== "function") throw new TypeError("openPrintDialog must be a function");

  const t = (key) => interfaceText(locale, key);
  return {
    async printWorkorders() {
      if (!activeWorkorderId) {
        setCreateState?.({
          busy: false,
          message: t("preview.createBeforePrint"),
        });
        return false;
      }

      const count = positivePrintCount(effectiveCopies);
      const printableForm = buildPrintableWorkorderForm(form);
      const pageCount = count * workorderPhysicalPageCount(form);

      try {
        setPrintMenuOpen(false);
        await openPrintDialog({ form: printableForm, serials: previewSerials });
        setPrintState({
          open: true,
          stage: "archiving",
          message: t("preview.savingArchive"),
          range,
          pageCount,
        });

        const result = await request("/api/print", {
          method: "POST",
          body: JSON.stringify({
            workorderId: activeWorkorderId,
            locationId: form.locationId || activeWorkorderLocationId || null,
            companyName: form.customerCompanyName,
            count,
            form: printableForm,
          }),
        });
        const serials = Array.isArray(result.serials) ? result.serials : [];
        const resolvedRange = printedSerialRange(serials, range);
        const resolvedPageCount = (serials.length || count)
          * workorderPhysicalPageCount(result.printForm || printableForm);
        const commonState = {
          open: true,
          downloadUrl: result.downloadUrl,
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
}) {
  const [printState, setPrintState] = useState(INITIAL_PRINT_STATE);
  const [browserPrintPayload, setBrowserPrintPayload] = useState(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);

  const openPrintDialog = useCallback((payload) => openBrowserPrintDialog({
    payload,
    setBrowserPrintPayload,
    scheduleFrame,
    fontsReady,
    printBrowser,
  }), [fontsReady, printBrowser, scheduleFrame]);

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
    locale,
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
    setPrintMenuOpen,
    setPrintState,
    togglePrintMenu,
  };
}
