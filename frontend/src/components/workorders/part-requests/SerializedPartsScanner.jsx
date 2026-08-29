import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle, Scan, XClose } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../../ui/Button.jsx";
import { DraggableBottomSheet } from "../../ui/DraggableBottomSheet.jsx";
import { InventoryCodeScanner } from "../../../features/inventory/InventoryCodeScanner.jsx";
import {
  enqueuePendingCandidate,
  inventoryUsageStatusLabel,
  mergeUsageSnapshot,
  removePendingCandidate,
  replaceUsage,
  shouldApplyUsageSnapshot,
} from "../../../features/inventory/inventory-code-scanner-model.js";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import "./mechanic-serialized-parts.css";

function requestKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function SerializedPartsScanner({ workorderId, onChanged, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const errorText = (error) => locale === "en" && error?.message ? error.message : t("mechanic.requestFailed");
  const usageStatus = (status) => t(`parts.status.${status}`) === `parts.status.${status}`
    ? inventoryUsageStatusLabel(status)
    : t(`parts.status.${status}`);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [usages, setUsages] = useState([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("status");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [drawerSnap, setDrawerSnap] = useState("peek");
  const finalizeKeysRef = useRef(new Map());
  const usageRevisionRef = useRef(0);
  const usagesLoadedRef = useRef(false);
  const resultHeadingRef = useRef(null);
  const scanTriggerRef = useRef(null);
  const scannerCloseRef = useRef(null);
  const workorderGenerationRef = useRef(0);
  const scannerPanelId = useId();
  const drawerSnapRef = useRef("peek");
  const restartAfterPeekRef = useRef(false);
  const candidate = pendingCandidates.find((item) => item.unit?.id === selectedCandidateId) || pendingCandidates.at(-1) || null;

  async function loadUsages(generation = workorderGenerationRef.current) {
    const requestedWorkorderId = workorderId;
    const revision = usageRevisionRef.current;
    const result = await api(`/api/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-unit-usages`);
    if (generation === workorderGenerationRef.current) {
      usagesLoadedRef.current = true;
      const snapshotIsCurrent = shouldApplyUsageSnapshot({
        requestGeneration: generation,
        currentGeneration: workorderGenerationRef.current,
        requestRevision: revision,
        currentRevision: usageRevisionRef.current,
      });
      setUsages((current) => snapshotIsCurrent
        ? (result.usages || [])
        : mergeUsageSnapshot(current, result.usages || []));
    }
  }

  useEffect(() => {
    workorderGenerationRef.current += 1;
    const generation = workorderGenerationRef.current;
    setPendingCandidates([]);
    setSelectedCandidateId(null);
    setBusy("");
    setMessage("");
    setMessageTone("status");
    setScannerOpen(false);
    setUsages([]);
    usagesLoadedRef.current = true;
    setDrawerSnap("peek");
    drawerSnapRef.current = "peek";
    restartAfterPeekRef.current = false;
    usageRevisionRef.current = 0;
    finalizeKeysRef.current.clear();
    loadUsages(generation).catch((error) => {
      if (generation !== workorderGenerationRef.current) return;
      usagesLoadedRef.current = false;
      setMessageTone("error");
      setMessage(errorText(error));
    });
  }, [workorderId]);

  useEffect(() => {
    if (scannerOpen) scannerCloseRef.current?.focus();
  }, [scannerOpen]);

  async function resolve(code) {
    const generation = workorderGenerationRef.current;
    const requestedWorkorderId = workorderId;
    setMessage("");
    setMessageTone("status");
    const result = await api(`/api/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-units/resolve`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (generation !== workorderGenerationRef.current) return;
    const nextCandidate = { ...result, code, issueKey: requestKey("serialized-issue") };
    const next = enqueuePendingCandidate(pendingCandidates, nextCandidate);
    setPendingCandidates(next.candidates);
    setSelectedCandidateId(next.selectedId);
    setDrawerSnap("expanded");
    drawerSnapRef.current = "expanded";
    window.requestAnimationFrame(() => resultHeadingRef.current?.focus());
  }

  async function issue() {
    if (!candidate?.eligibility?.canIssue || busy) return;
    const generation = workorderGenerationRef.current;
    const requestedWorkorderId = workorderId;
    setBusy("issue");
    setMessage("");
    setMessageTone("status");
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-units/issue`, {
        method: "POST",
        body: JSON.stringify({ code: candidate.code, idempotencyKey: candidate.issueKey }),
      });
      if (generation !== workorderGenerationRef.current) return;
      usageRevisionRef.current += 1;
      setUsages((current) => replaceUsage(current, result.usage));
      const nextCandidates = removePendingCandidate(pendingCandidates, candidate.unit.id);
      setPendingCandidates(nextCandidates);
      setSelectedCandidateId(nextCandidates.at(-1)?.unit?.id || null);
      if (nextCandidates.length) {
        setDrawerSnap("expanded");
        drawerSnapRef.current = "expanded";
      } else {
        restartScannerAfterFinalIssue();
      }
      setMessage(`${result.usage.partNumber} ${t("parts.issuedToWorkorder")}`);
      await onChanged?.();
    } catch (error) {
      if (generation !== workorderGenerationRef.current) return;
      setMessageTone("error");
      setMessage(errorText(error));
    } finally {
      if (generation === workorderGenerationRef.current) setBusy("");
    }
  }

  async function finalize(usage, disposition) {
    if (busy) return;
    const generation = workorderGenerationRef.current;
    const requestedWorkorderId = workorderId;
    const mapKey = `${usage.id}:${disposition}`;
    if (!finalizeKeysRef.current.has(mapKey)) {
      finalizeKeysRef.current.set(mapKey, requestKey(`serialized-${disposition}`));
    }
    setBusy(mapKey);
    setMessage("");
    setMessageTone("status");
    try {
      const result = await api(
        `/api/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-unit-usages/${encodeURIComponent(usage.id)}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({
            disposition,
            idempotencyKey: finalizeKeysRef.current.get(mapKey),
          }),
        },
      );
      if (generation !== workorderGenerationRef.current) return;
      usageRevisionRef.current += 1;
      setUsages((current) => replaceUsage(current, result.usage));
      setMessage(disposition === "installed" ? t("parts.installationRecorded") : t("parts.returnedToStock"));
      await onChanged?.();
    } catch (error) {
      if (generation !== workorderGenerationRef.current) return;
      setMessageTone("error");
      setMessage(errorText(error));
    } finally {
      if (generation === workorderGenerationRef.current) setBusy("");
    }
  }

  const unresolved = usages.filter((usage) => usage.status === "issued");
  const completed = usages.filter((usage) => usage.status !== "issued");
  const collapsed = !scannerOpen && pendingCandidates.length === 0 && usages.length === 0 && !message;

  function closeScanner() {
    if (busy) return;
    setScannerOpen(false);
    setPendingCandidates([]);
    setSelectedCandidateId(null);
    setDrawerSnap("peek");
    drawerSnapRef.current = "peek";
    restartAfterPeekRef.current = false;
    setResetKey((value) => value + 1);
    setMessage("");
    setMessageTone("status");
    window.requestAnimationFrame(() => scanTriggerRef.current?.focus());
  }

  function openScanner() {
    setScannerOpen(true);
    setMessage("");
    setMessageTone("status");
    if (usagesLoadedRef.current) return;
    usagesLoadedRef.current = true;
    loadUsages().catch((error) => {
      usagesLoadedRef.current = false;
      setMessageTone("error");
      setMessage(errorText(error));
    });
  }

  function returnToScannerPeek() {
    if (drawerSnapRef.current === "peek") return;
    drawerSnapRef.current = "peek";
    restartAfterPeekRef.current = true;
    setDrawerSnap("peek");
  }

  function restartScannerAfterFinalIssue() {
    drawerSnapRef.current = "peek";
    restartAfterPeekRef.current = false;
    setDrawerSnap("peek");
    if (scannerOpen) setResetKey((value) => value + 1);
  }

  function minimizeDrawer() {
    if (busy) return;
    returnToScannerPeek();
  }

  function handleDrawerSnapChange(nextSnap) {
    if (busy) return;
    if (nextSnap === "peek") {
      minimizeDrawer();
      return;
    }
    drawerSnapRef.current = "expanded";
    setDrawerSnap("expanded");
  }

  function handleDrawerSnapSettled(settledSnap) {
    if (drawerSnap !== "peek") return;
    if (settledSnap !== "peek" || !restartAfterPeekRef.current) return;
    if (!scannerOpen || drawerSnapRef.current !== "peek") return;
    restartAfterPeekRef.current = false;
    setResetKey((value) => value + 1);
  }

  return (
    <section className={`mechanic-serialized-parts${collapsed ? " is-collapsed" : ""}`} aria-label={t("parts.serialized")}>

      {!scannerOpen ? (
        <button
          type="button"
          ref={scanTriggerRef}
          className="mechanic-scan-trigger"
          aria-label={t("parts.scanParts")}
          aria-controls={scannerPanelId}
          aria-expanded={scannerOpen}
          data-tooltip={t("parts.scanParts")}
          onClick={openScanner}
        >
          <Scan aria-hidden="true" focusable="false" />
        </button>
      ) : null}

      {scannerOpen ? (
        <ModalOverlay
          className="mechanic-scanner-overlay"
          isOpen={scannerOpen}
          isDismissable={!busy}
          onOpenChange={(open) => { if (!open) closeScanner(); }}
        >
          <Modal className="mechanic-scanner-modal">
            <Dialog className="mechanic-scanner-panel" id={scannerPanelId} aria-label={t("parts.scanSerialized")}>
              <header className="mechanic-scanner-header">
                <button
                  type="button"
                  ref={scannerCloseRef}
                  className="mechanic-scanner-close"
                  aria-label={t("parts.closeScanner")}
                  onClick={closeScanner}
                  disabled={Boolean(busy)}
                >
                  <XClose aria-hidden="true" focusable="false" />
                </button>
              </header>
              {drawerSnap !== "expanded" && !restartAfterPeekRef.current ? (
                <InventoryCodeScanner
                  autoStart
                  onScan={resolve}
                  resetKey={`${workorderId}:${resetKey}`}
                  disabled={Boolean(busy)}
                  labels={{
                    cameraLabel: t("parts.scannerCamera"),
                    enterCode: t("parts.enterCode"),
                    codeLabel: t("parts.codeLabel"),
                    codePlaceholder: t("parts.codePlaceholder"),
                    checking: t("parts.checking"),
                    openPart: t("parts.openPart"),
                    openError: t("parts.openError"),
                    cameraUnavailable: t("parts.cameraUnavailable"),
                    cameraAccessUnavailable: t("parts.cameraAccessUnavailable"),
                  }}
                />
              ) : null}
              {candidate ? (
                <DraggableBottomSheet
                  open
                  snap={drawerSnap}
                  onSnapChange={handleDrawerSnapChange}
                  onSnapSettled={handleDrawerSnapSettled}
                  disabled={Boolean(busy)}
                  title={t("parts.scannedPart")}
                  minimizeLabel={t("parts.minimizeResult")}
                  expandLabel={t("parts.expandDetails")}
                >
                  <section className="mechanic-scanner-result-drawer" aria-live="polite">
                    <div className="mechanic-scanner-result-summary">
                      <h4 ref={resultHeadingRef} tabIndex="-1">{candidate.unit.partNumber}</h4>
                      <span>{candidate.unit.description}</span>
                      <span className="mechanic-scanner-result-eligibility">{candidate.eligibility.canIssue ? t("parts.readyToUse") : t("parts.unavailable")}</span>
                      <span className="mechanic-scanner-pending-count">{pendingCandidates.length} {t("parts.pendingScans")}</span>
                    </div>
                    <dl className="mechanic-scanner-result-details">
                      <div><dt>{t("parts.serial")}</dt><dd><code>{candidate.unit.serialNumber}</code></dd></div>
                      <div><dt>{t("parts.workorderUnit")}</dt><dd>{candidate.workorder.asset?.unitNo || candidate.workorder.asset?.name || t("parts.linkedAsset")}</dd></div>
                      <div><dt>{t("queue.location")}</dt><dd>{candidate.unit.locationName}</dd></div>
                    </dl>
                    <div className="mechanic-scanner-result-actions">
                      {candidate.eligibility.canIssue ? (
                        <Button type="button" variant="primary" onClick={issue} disabled={busy === "issue"}>
                          {busy === "issue" ? t("parts.using") : t("parts.useOnWorkorder")}
                        </Button>
                      ) : <p className="mechanic-serialized-blocked" role="alert" aria-live="assertive">{locale === "en" ? candidate.eligibility.message : t("parts.serializedUnavailable")}</p>}
                      <Button type="button" onClick={minimizeDrawer} disabled={Boolean(busy)}>
                        {t("parts.scanAnother")}
                      </Button>
                    </div>
                    {messageTone === "error" && message ? <p className="mechanic-serialized-message" role="alert" aria-live="assertive">{message}</p> : null}
                  </section>
                </DraggableBottomSheet>
              ) : null}
              {scannerOpen && messageTone === "status" && message ? <p className="mechanic-scanner-sr-status" role="status" aria-live="polite">{message}</p> : null}
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}

      {unresolved.map((usage) => (
        <article className="mechanic-serialized-usage is-issued" key={usage.id}>
          <div><strong>{usage.partNumber}</strong><code>{usage.serialNumber}</code><span>{usageStatus(usage.status)}</span></div>
          <fieldset disabled={Boolean(busy)}>
            <legend>{t("parts.disposition")}</legend>
            <Button type="button" variant="primary" onClick={() => finalize(usage, "installed")}>
              {t("parts.installed")}
            </Button>
            <Button type="button" onClick={() => finalize(usage, "returned")}>
              {t("parts.returnUnused")}
            </Button>
          </fieldset>
        </article>
      ))}

      {completed.length ? (
        <ol className="mechanic-serialized-history" aria-label={t("parts.completedSerializedHistory")}>
          {completed.map((usage) => (
            <li key={usage.id}><CheckCircle aria-hidden="true" /><span><strong>{usage.partNumber}</strong><code>{usage.serialNumber}</code><small>{usageStatus(usage.status)}</small></span></li>
          ))}
        </ol>
      ) : null}
      {!scannerOpen && message ? <p className="mechanic-serialized-message" role={messageTone === "error" ? "alert" : "status"} aria-live={messageTone === "error" ? "assertive" : "polite"}>{message}</p> : null}
    </section>
  );
}
