import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, XClose } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
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
  locationId,
  initiallyCollapsed = false,
  dropdown = false,
  catalogPartId,
  partNumber,
  assetId,
  currentRepairOrder = "",
  onApply,
  disabled = false,
  locale = "en",
}) {
  const t = (key) => interfaceText(locale, key);
  const panelId = useId();
  const requestSequence = useRef(0);
  const normalizedRepairOrder = String(currentRepairOrder || "").trim();
  const [expanded, setExpanded] = useState(() => !initiallyCollapsed && !normalizedRepairOrder);
  const [state, setState] = useState("idle");
  const [suggestions, setSuggestions] = useState([]);
  const normalizedPartNumber = String(partNumber || "").trim();

  useEffect(() => {
    setExpanded(!initiallyCollapsed && !normalizedRepairOrder);
  }, [catalogPartId, normalizedPartNumber, normalizedRepairOrder, initiallyCollapsed, locationId]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setSuggestions([]);

    if (disabled || (!workorderId && !locationId) || !catalogPartId || !normalizedPartNumber) {
      setState("idle");
      return () => controller.abort();
    }

    setState("waiting");
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const params = new URLSearchParams({
          ...(workorderId ? { workorderId } : { locationId }),
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
  }, [catalogPartId, disabled, normalizedPartNumber, workorderId, locationId]);

  if (state === "idle") return null;

  if (!expanded && !dropdown) {
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

  const content = (
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
                onClick={() => {
                  onApply(suggestion.text);
                  setExpanded(false);
                }}
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

  if (!dropdown) return content;

  return (
    <div className="repair-history-field-dropdown">
      <DialogTrigger isOpen={expanded} onOpenChange={setExpanded}>
        <Button type="button" className="repair-history-field-trigger" aria-label={t("parts.showPreviousWork")} isDisabled={disabled}>
          <ChevronDown aria-hidden="true" />
        </Button>
        <Popover className="repair-history-field-popover" placement="bottom end" offset={6}>
          <Dialog aria-label={t("parts.repairHistorySuggestions")}>{content}</Dialog>
        </Popover>
      </DialogTrigger>
    </div>
  );
}
