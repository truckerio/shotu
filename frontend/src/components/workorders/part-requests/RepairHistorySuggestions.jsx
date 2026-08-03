import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
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
}) {
  const requestSequence = useRef(0);
  const [state, setState] = useState("idle");
  const [suggestions, setSuggestions] = useState([]);
  const normalizedPartNumber = String(partNumber || "").trim();

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

  return (
    <section className="repair-history-suggestions" aria-label="Repair order suggestions from service history">
      <div className="repair-history-heading">
        <strong>Previous work with this part</strong>
        <span>Nothing is filled until you apply a suggestion.</span>
      </div>
      {state === "results" ? (
        <ul>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <div>
                <span className="repair-history-text">{suggestion.text}</span>
                <small>{repairSuggestionMeta(suggestion, assetId)}</small>
              </div>
              <button
                type="button"
                onClick={() => onApply(suggestion.text)}
                disabled={disabled}
                aria-label={`Apply repair order suggestion: ${suggestion.text}`}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="repair-history-state" role="status">
          {state === "waiting" || state === "loading"
            ? "Checking service history…"
            : state === "error"
              ? "Service history suggestions are unavailable."
              : "No previous repair wording found for this part."}
        </p>
      )}
    </section>
  );
}
