import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle, Tool02 } from "@untitledui/icons";
import { Button } from "../../ui/Button.jsx";
import { InventoryCodeScanner } from "../../../features/inventory/InventoryCodeScanner.jsx";
import { inventoryUsageStatusLabel, replaceUsage } from "../../../features/inventory/inventory-code-scanner-model.js";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import "./mechanic-serialized-parts.css";

function requestKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function MechanicSerializedParts({ workorderId, onChanged, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const errorText = (error) => locale === "en" && error?.message ? error.message : t("mechanic.requestFailed");
  const usageStatus = (status) => t(`parts.status.${status}`) === `parts.status.${status}`
    ? inventoryUsageStatusLabel(status)
    : t(`parts.status.${status}`);
  const [candidate, setCandidate] = useState(null);
  const [usages, setUsages] = useState([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("status");
  const [resetKey, setResetKey] = useState(0);
  const issueKeyRef = useRef("");
  const finalizeKeysRef = useRef(new Map());
  const resultHeadingRef = useRef(null);
  const workorderGenerationRef = useRef(0);
  const sectionTitleId = useId();

  async function loadUsages(generation = workorderGenerationRef.current) {
    const requestedWorkorderId = workorderId;
    const result = await api(`/api/mechanic/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-unit-usages`);
    if (generation === workorderGenerationRef.current) setUsages(result.usages || []);
  }

  useEffect(() => {
    workorderGenerationRef.current += 1;
    const generation = workorderGenerationRef.current;
    setCandidate(null);
    setBusy("");
    setMessage("");
    setMessageTone("status");
    issueKeyRef.current = "";
    finalizeKeysRef.current.clear();
    loadUsages(generation).catch((error) => {
      if (generation === workorderGenerationRef.current) { setMessageTone("error"); setMessage(errorText(error)); }
    });
  }, [workorderId]);

  async function resolve(code) {
    const generation = workorderGenerationRef.current;
    const requestedWorkorderId = workorderId;
    setMessage("");
    setMessageTone("status");
    const result = await api(`/api/mechanic/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-units/resolve`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (generation !== workorderGenerationRef.current) return;
    issueKeyRef.current = requestKey("serialized-issue");
    setCandidate({ ...result, code });
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
      const result = await api(`/api/mechanic/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-units/issue`, {
        method: "POST",
        body: JSON.stringify({ code: candidate.code, idempotencyKey: issueKeyRef.current }),
      });
      if (generation !== workorderGenerationRef.current) return;
      setUsages((current) => replaceUsage(current, result.usage));
      setCandidate(null);
      setResetKey((value) => value + 1);
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
        `/api/mechanic/workorders/${encodeURIComponent(requestedWorkorderId)}/inventory-unit-usages/${encodeURIComponent(usage.id)}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({
            disposition,
            idempotencyKey: finalizeKeysRef.current.get(mapKey),
          }),
        },
      );
      if (generation !== workorderGenerationRef.current) return;
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

  return (
    <section className="mechanic-serialized-parts" aria-labelledby={sectionTitleId}>
      <header>
        <Tool02 aria-hidden="true" />
        <div><h3 id={sectionTitleId}>{t("parts.serialized")}</h3><p>{t("parts.serializedHelp")}</p></div>
      </header>

      {candidate ? (
        <section className="mechanic-serialized-candidate" aria-live="polite">
          <h4 ref={resultHeadingRef} tabIndex="-1">{t("parts.confirmExact")}</h4>
          <dl>
            <div><dt>{t("parts.part")}</dt><dd><strong>{candidate.unit.partNumber}</strong><span>{candidate.unit.description}</span></dd></div>
            <div><dt>{t("parts.serial")}</dt><dd><code>{candidate.unit.serialNumber}</code></dd></div>
            <div><dt>{t("parts.workorderUnit")}</dt><dd>{candidate.workorder.asset?.unitNo || candidate.workorder.asset?.name || t("parts.linkedAsset")}</dd></div>
            <div><dt>{t("queue.location")}</dt><dd>{candidate.unit.locationName}</dd></div>
          </dl>
          {candidate.eligibility.canIssue ? (
            <Button type="button" variant="primary" onClick={issue} disabled={busy === "issue"}>
              {busy === "issue" ? t("parts.using") : t("parts.useOnWorkorder")}
            </Button>
          ) : <p className="mechanic-serialized-blocked" role="alert">{locale === "en" ? candidate.eligibility.message : t("parts.serializedUnavailable")}</p>}
          <Button type="button" onClick={() => { setCandidate(null); setResetKey((value) => value + 1); }} disabled={Boolean(busy)}>
            {t("parts.scanDifferent")}
          </Button>
        </section>
      ) : <InventoryCodeScanner
        onScan={resolve}
        resetKey={`${workorderId}:${resetKey}`}
        disabled={Boolean(busy)}
        title={t("parts.scanSerialized")}
        labels={{
          cameraLabel: t("parts.scannerCamera"),
          stopCamera: t("parts.stopCamera"),
          startingCamera: t("parts.startingCamera"),
          useCamera: t("parts.useCamera"),
          codeLabel: t("parts.codeLabel"),
          codePlaceholder: t("parts.codePlaceholder"),
          checking: t("parts.checking"),
          openPart: t("parts.openPart"),
          openError: t("parts.openError"),
          cameraUnavailable: t("parts.cameraUnavailable"),
          cameraAccessUnavailable: t("parts.cameraAccessUnavailable"),
        }}
      />}

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
      {message ? <p className="mechanic-serialized-message" role={messageTone === "error" ? "alert" : "status"} aria-live={messageTone === "error" ? "assertive" : "polite"}>{message}</p> : null}
    </section>
  );
}
