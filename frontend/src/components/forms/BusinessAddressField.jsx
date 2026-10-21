import { useEffect, useId, useRef, useState } from "react";
import { FormField } from "./FormField.jsx";
import { createGoogleAddressSession, loadGoogleAddressLibrary } from "./google-address-suggestions.js";
import googleMapsAttribution from "./google-maps-attribution.svg";
import "./business-address-field.css";

export function BusinessAddressField({ value = "", onChange, request, scope = "", disabled = false }) {
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = `business-address-${useId().replaceAll(":", "")}`;
  const initialRequest = useRef(request);
  const generation = useRef(0);
  const session = useRef(null);
  const live = useRef({ value, scope, focused: false });
  const lastValue = useRef(value);
  live.current.value = value;
  live.current.scope = scope;

  useEffect(() => {
    const controller = new AbortController();
    if (typeof initialRequest.current === "function") {
      Promise.resolve().then(() => initialRequest.current("/api/config", { signal: controller.signal }))
        .then((config) => { if (!controller.signal.aborted) setApiKey(config?.maps?.googleMapsBrowserApiKey || ""); })
        .catch(() => {});
    }
    return () => { controller.abort(); generation.current++; session.current?.reset(); };
  }, []);

  useEffect(() => {
    if (lastValue.current !== value) {
      generation.current++; lastValue.current = value; setQuery(""); setSuggestions([]); setActiveIndex(-1); session.current?.reset();
    }
  }, [value]);

  useEffect(() => {
    generation.current++; setQuery(""); setSuggestions([]); setActiveIndex(-1); session.current?.reset();
  }, [scope, disabled]);

  useEffect(() => {
    if (!apiKey || !focused || disabled || query.trim().length < 3) return undefined;
    const current = generation.current;
    const expectedScope = scope;
    const timer = window.setTimeout(async () => {
      try {
        const library = await loadGoogleAddressLibrary(apiKey);
        if (!library || generation.current !== current || !live.current.focused || live.current.scope !== expectedScope) return;
        session.current ||= createGoogleAddressSession(library);
        const results = await session.current.predict(query);
        if (generation.current === current && live.current.focused && live.current.value === query && live.current.scope === expectedScope) {
          setSuggestions(results); setActiveIndex(-1);
        }
      } catch { if (generation.current === current) setSuggestions([]); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [apiKey, query, focused, disabled, scope]);

  function dismiss() {
    generation.current++; setSuggestions([]); setActiveIndex(-1); setQuery(""); session.current?.reset();
  }
  function edit(next) {
    generation.current++; lastValue.current = next; live.current.value = next;
    setSuggestions([]); setActiveIndex(-1); setQuery(next);
    if (next.trim().length < 3) session.current?.reset();
    onChange?.(next);
  }
  async function select(suggestion) {
    const current = ++generation.current;
    const expectedScope = live.current.scope;
    const expectedValue = live.current.value;
    setSuggestions([]); setActiveIndex(-1); setQuery("");
    try {
      const address = await session.current.resolve(suggestion);
      if (address && generation.current === current && live.current.focused && live.current.scope === expectedScope && live.current.value === expectedValue) {
        lastValue.current = address; live.current.value = address; onChange?.(address);
      }
    } catch { /* Manual address remains available. */ }
  }
  function keyDown(event) {
    if (event.key === "Escape") { dismiss(); return; }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => event.key === "ArrowDown" ? (index + 1) % suggestions.length : (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault(); select(suggestions[activeIndex]);
    }
  }

  return <FormField label="Business address" hint="Include city, state, and ZIP.">{(accessibility) => <div className="business-address-field">
    <textarea id={accessibility.id} aria-describedby={accessibility.describedBy} aria-label="Business address" rows="3" value={value} disabled={disabled}
      role="combobox" aria-autocomplete="list" aria-expanded={Boolean(suggestions.length)} aria-controls={suggestions.length ? listId : undefined} aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      onChange={(event) => edit(event.target.value)} onKeyDown={keyDown}
      onFocus={() => { live.current.focused = true; setFocused(true); }} onBlur={() => { live.current.focused = false; setFocused(false); dismiss(); }} />
    {suggestions.length ? <div className="business-address-suggestions">
      <div role="listbox" id={listId} aria-label="Address suggestions">{suggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={activeIndex === index} id={`${listId}-${index}`} key={`${index}-${suggestion.label}`} tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={() => select(suggestion)}>{suggestion.label}</button>)}</div>
      <div className="business-address-attribution"><img src={googleMapsAttribution} alt="Google Maps" /></div>
    </div> : null}
  </div>}</FormField>;
}
