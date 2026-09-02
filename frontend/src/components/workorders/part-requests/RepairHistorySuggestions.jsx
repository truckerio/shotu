import { useEffect, useId, useRef, useState } from "react";
import { XClose } from "@untitledui/icons";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import { SectionHelpDisclosure } from "../SectionHelpDisclosure.jsx";
import {
  normalizeRepairSuggestionsResponse,
  repairSuggestionMeta,
} from "./repair-suggestions-model.js";
import "./repair-history-suggestions.css";

const LOAD_DELAY_MS = 250;

export function RepairHistorySuggestions({
  workorderId,
  catalogPartId,
  partNumber,
  assetId,
  onApply,
  disabled = false,
  locale = "en",
}) {
  const t = (key) => interfaceText(locale, key);
  const panelId = useId();
  const requestSequence = useRef(0);
  const [expanded, setExpanded] = useState(true);
  const [state, setState] = useState("idle");
  const [suggestions, setSuggestions] = useState([]);
  const normalizedPartNumber = String(partNumber || "").trim();

  useEffect(() => {
    setExpanded(true);
  }, [catalogPartId, normalizedPartNumber]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setSuggestions([]);

    if (disabled || !workorderId || !catalogPartId || !normalizedPartNumber) {
      setState("idle");
      return () => controller.abort();
    }

    setState("waiting");
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const params = new URLSearchParams({
          workorderId,
          catalogPartId,
          partNumber: normalizedPartNumber,
          limit: "5",
        });
        const payload = await api(`/api/parts-helper/repair-suggestions?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        const next = normalizeRepairSuggestionsResponse(payload);
        setSuggestions(next);
        setState(next.length ? "results" : "empty");
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setSuggestions([]);
        setState("error");
      }
    }, LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogPartId, disabled, normalizedPartNumber, workorderId]);

  if (state === "idle") return null;

  if (!expanded) {
    return (
      <button
        className="repair-history-reopen"
        type="button"
        aria-controls={panelId}
        aria-expanded="false"
        onClick={() => setExpanded(true)}
      >
        {t("parts.showPreviousWork")}
      </button>
    );
  }

  return (
    <section id={panelId} className="repair-history-suggestions" aria-label={t("parts.repairHistorySuggestions")}>
      <div className="repair-history-heading">
        <div className="repair-history-heading-copy">
          <strong>{t("parts.previousWorkWithPart")}</strong>
          <SectionHelpDisclosure label={t("parts.repairSuggestionHelp")}><p>{t("parts.repairSuggestionHelp")}</p></SectionHelpDisclosure>
        </div>
        <button
          className="repair-history-dismiss"
          type="button"
          aria-label={t("parts.hidePreviousWorkSuggestions")}
          aria-controls={panelId}
          aria-expanded="true"
          onClick={() => setExpanded(false)}
        >
          <XClose aria-hidden="true" />
        </button>
      </div>
      {state === "results" ? (
        <ul>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <div>
                <span className="repair-history-text">{suggestion.text}</span>
                <small>{repairSuggestionMeta(suggestion, assetId, locale)}</small>
              </div>
              <button
                type="button"
                onClick={() => onApply(suggestion.text)}
                disabled={disabled}
                aria-label={`${t("parts.applyRepairSuggestion")}: ${suggestion.text}`}
              >
                {t("parts.apply")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="repair-history-state" role="status">
          {state === "waiting" || state === "loading"
            ? t("parts.checkingServiceHistory")
            : state === "error"
              ? t("parts.serviceHistorySuggestionsUnavailable")
              : t("parts.noPreviousRepairWording")}
        </p>
      )}
    </section>
  );
}
