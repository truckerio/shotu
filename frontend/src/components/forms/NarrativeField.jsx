import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RichTextarea, experimental_RichInput as RichInput } from "rich-textarea";
import {
  canAutoReplaceNarrativeIssue,
  issueOccurrenceKey,
} from "./narrative-correction-model.js";
import {
  addNarrativeDictionaryWord,
  checkNarrativeSpelling,
} from "./narrative-spellcheck-engine.js";
import { textEntryProps } from "./text-entry-policy.js";
import "./narrative-field.css";

const CHECK_DELAY_MS = 650;
const PROVIDER_BACKOFF_MS = 30_000;

function highlightedText(text, issues, onActivate) {
  if (!issues.length) return text;
  const content = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.start > cursor) content.push(text.slice(cursor, issue.start));
    content.push(
      <span
        className={`narrative-proofreading-error is-${issue.kind}`}
        key={`${issue.kind}-${issue.start}-${issue.end}`}
        onClick={() => onActivate(issue)}
      >
        {text.slice(issue.start, issue.end)}
      </span>,
    );
    cursor = issue.end;
  }
  if (cursor < text.length) content.push(text.slice(cursor));
  return content;
}

function issueAtSelection(issues, control) {
  const start = control?.selectionStart;
  const end = control?.selectionEnd;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  return issues.find((issue) => (
    (start >= issue.start && start <= issue.end)
      || (end >= issue.start && end <= issue.end)
      || (start <= issue.start && end >= issue.end)
  )) || null;
}

function issueLabel(issue) {
  return issue.kind === "spelling" ? "Spelling" : "Grammar and context";
}

function setControlRange(control, replacement, start, end, selectionMode) {
  control.setRangeText(replacement, start, end, selectionMode);
}

export const NarrativeField = forwardRef(function NarrativeField(
  {
    className = "",
    companyId,
    onBlur,
    onChange,
    onCompositionEnd,
    onCompositionStart,
    onFocus,
    onKeyDown,
    onSelect,
    singleLine = false,
    style,
    value = "",
    ...props
  },
  forwardedRef,
) {
  const controlRef = useRef(null);
  const dictionaryControllerRef = useRef(null);
  const dictionaryWordsRef = useRef(new Set());
  const ignoredIssuesRef = useRef(new Set());
  const isComposingRef = useRef(false);
  const latestTextRef = useRef("");
  const menuRef = useRef(null);
  const providerBackoffUntilRef = useRef(0);
  const requestControllerRef = useRef(null);
  const requestRef = useRef(0);
  const wasFocusedRef = useRef(false);
  const wrapperRef = useRef(null);
  const statusId = useId();
  const [activeIssue, setActiveIssue] = useState(null);
  const [checkRevision, setCheckRevision] = useState(0);
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [issues, setIssues] = useState([]);
  const [menuLayout, setMenuLayout] = useState({ above: false, maxHeight: 280 });
  const [providerAvailable, setProviderAvailable] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const text = String(value || "");
  latestTextRef.current = text;

  useImperativeHandle(forwardedRef, () => controlRef.current);

  function replaceRange(issue, replacement, { automatic = false } = {}) {
    const control = controlRef.current;
    if (!control?.setRangeText || text.slice(issue.start, issue.end) !== issue.problem) return false;
    setControlRange(
      control,
      replacement,
      issue.start,
      issue.end,
      automatic ? "preserve" : "end",
    );
    setStatusMessage("");
    setActiveIssue(null);
    setIssues([]);
    if (!automatic) {
      requestAnimationFrame(() => {
        controlRef.current?.focus({ preventScroll: true });
        const caret = issue.start + replacement.length;
        controlRef.current?.setSelectionRange?.(caret, caret);
      });
    }
    return true;
  }

  useEffect(() => {
    const requestId = ++requestRef.current;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setIssues([]);
    setActiveIssue(null);

    const blurred = wasFocusedRef.current && !focused;
    wasFocusedRef.current = focused;
    if (text.trim().length < 3 || isComposingRef.current) return undefined;

    const mode = focused ? "fast" : blurred && !singleLine ? "deep" : null;
    if (!mode) return undefined;
    if (Date.now() < providerBackoffUntilRef.current) {
      setProviderAvailable(false);
      return undefined;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestedText = text;
    let timer = null;
    const execute = () => {
      checkNarrativeSpelling(requestedText, { companyId, mode, signal: controller.signal })
        .then((nextIssues) => {
          if (
            requestId !== requestRef.current
            || controller.signal.aborted
            || latestTextRef.current !== requestedText
          ) return;
          const visibleIssues = nextIssues.filter((issue) => (
            !ignoredIssuesRef.current.has(issueOccurrenceKey(issue))
            && !dictionaryWordsRef.current.has(issue.problem.toLocaleLowerCase("en-US"))
          ));
          setProviderAvailable(true);
          setIssues(visibleIssues);

          if (mode !== "fast" || !focused) return;
          const control = controlRef.current;
          const eligible = visibleIssues.filter((issue) => canAutoReplaceNarrativeIssue({
            issue,
            isComposing: isComposingRef.current,
            selectionEnd: control?.selectionEnd,
            selectionStart: control?.selectionStart,
            text: requestedText,
          }));
          if (eligible.length === 1) {
            replaceRange(eligible[0], eligible[0].suggestions[0], { automatic: true });
          }
        })
        .catch((error) => {
          if (requestId !== requestRef.current || error?.name === "AbortError") return;
          setIssues([]);
          setProviderAvailable(false);
          providerBackoffUntilRef.current = Date.now() + PROVIDER_BACKOFF_MS;
        });
    };

    if (mode === "deep") execute();
    else timer = setTimeout(execute, CHECK_DELAY_MS);
    return () => {
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [checkRevision, companyId, focused, singleLine, text]);

  useEffect(() => () => {
    dictionaryControllerRef.current?.abort();
    requestControllerRef.current?.abort();
  }, []);

  useLayoutEffect(() => {
    if (!activeIssue || typeof window === "undefined") return undefined;
    const updatePlacement = () => {
      const controlRect = controlRef.current?.getBoundingClientRect?.();
      const menuRect = menuRef.current?.getBoundingClientRect?.();
      if (!controlRect || !menuRect) return;
      const viewport = window.visualViewport;
      const viewportTop = Number(viewport?.offsetTop) || 0;
      const viewportBottom = viewportTop + (Number(viewport?.height) || window.innerHeight);
      const below = Math.max(0, viewportBottom - controlRect.bottom - 8);
      const above = Math.max(0, controlRect.top - viewportTop - 8);
      const placeAbove = below < menuRect.height && above > below;
      const maxHeight = Math.max(44, Math.floor((placeAbove ? above : below) - 4));
      setMenuLayout((current) => (
        current.above === placeAbove && current.maxHeight === maxHeight
          ? current
          : { above: placeAbove, maxHeight }
      ));
    };
    updatePlacement();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updatePlacement);
    viewport?.addEventListener("scroll", updatePlacement);
    window.addEventListener("resize", updatePlacement);
    return () => {
      viewport?.removeEventListener("resize", updatePlacement);
      viewport?.removeEventListener("scroll", updatePlacement);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [activeIssue]);

  const renderedText = useMemo(
    () => highlightedText(text, issues, (issue) => {
      setActiveIssue(issue);
      setStatusMessage(`${issueLabel(issue)} suggestion available for “${issue.problem}”.`);
    }),
    [issues, text],
  );
  const Control = singleLine ? RichInput : RichTextarea;

  function updateActiveIssue() {
    const issue = issueAtSelection(issues, controlRef.current);
    setActiveIssue(issue);
    if (issue) setStatusMessage(`${issueLabel(issue)} suggestion available for “${issue.problem}”.`);
  }

  function ignoreActiveIssue() {
    if (!activeIssue) return;
    ignoredIssuesRef.current.add(issueOccurrenceKey(activeIssue));
    setIssues((current) => current.filter((issue) => issueOccurrenceKey(issue) !== issueOccurrenceKey(activeIssue)));
    setStatusMessage(`Ignored “${activeIssue.problem}” once.`);
    setActiveIssue(null);
    controlRef.current?.focus({ preventScroll: true });
  }

  async function addActiveWordToDictionary() {
    if (!activeIssue || activeIssue.kind !== "spelling" || dictionaryBusy) return;
    const word = activeIssue.problem.toLocaleLowerCase("en-US");
    dictionaryControllerRef.current?.abort();
    const controller = new AbortController();
    dictionaryControllerRef.current = controller;
    setDictionaryBusy(true);
    try {
      await addNarrativeDictionaryWord(activeIssue.problem, { companyId, signal: controller.signal });
      dictionaryWordsRef.current.add(word);
      setIssues((current) => current.filter((issue) => issue.problem.toLocaleLowerCase("en-US") !== word));
      setStatusMessage(`Added “${activeIssue.problem}” to your dictionary.`);
      setActiveIssue(null);
      controlRef.current?.focus({ preventScroll: true });
    } catch (error) {
      if (error?.name !== "AbortError") setStatusMessage(error.message);
    } finally {
      if (!controller.signal.aborted) setDictionaryBusy(false);
    }
  }

  function handleMenuKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveIssue(null);
      controlRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...(menuRef.current?.querySelectorAll("button:not(:disabled)") || [])];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    buttons[(index + direction + buttons.length) % buttons.length]?.focus();
  }

  const describedBy = [props["aria-describedby"], statusId].filter(Boolean).join(" ");
  return (
    <span className={`narrative-field ${singleLine ? "is-single-line" : ""}`} ref={wrapperRef}>
      <Control
        {...textEntryProps("narrative")}
        {...props}
        aria-describedby={describedBy}
        className={`narrative-field-control ${className}`.trim()}
        ref={controlRef}
        spellCheck={providerAvailable !== true}
        style={{ ...style, width: style?.width || "100%" }}
        value={text}
        onBlur={(event) => {
          const movingToMenu = menuRef.current?.contains(event.relatedTarget);
          if (!movingToMenu) {
            setFocused(false);
            setActiveIssue(null);
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          setIssues([]);
          setActiveIssue(null);
          setStatusMessage("");
          onChange?.(event);
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false;
          setCheckRevision((current) => current + 1);
          onCompositionEnd?.(event);
        }}
        onCompositionStart={(event) => {
          isComposingRef.current = true;
          requestControllerRef.current?.abort();
          setIssues([]);
          setActiveIssue(null);
          onCompositionStart?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.altKey && event.key === "ArrowDown" && activeIssue) {
            event.preventDefault();
            menuRef.current?.querySelector("button:not(:disabled)")?.focus();
          }
          if (singleLine && event.key === "Enter" && !event.defaultPrevented) event.preventDefault();
          if (event.key === "Escape") setActiveIssue(null);
        }}
        onSelect={(event) => {
          updateActiveIssue();
          onSelect?.(event);
        }}
        onSelectionChange={updateActiveIssue}
        {...(singleLine ? { type: props.type || "text" } : { rows: props.rows })}
      >
        {() => renderedText}
      </Control>
      {activeIssue ? (
        <span
          className={`narrative-suggestion-menu ${menuLayout.above ? "is-above" : "is-below"}`}
          ref={menuRef}
          role="dialog"
          aria-label={`${issueLabel(activeIssue)} suggestions for ${activeIssue.problem}`}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            setActiveIssue(null);
            setFocused(false);
          }}
          onKeyDown={handleMenuKeyDown}
          style={{ maxHeight: `${menuLayout.maxHeight}px` }}
        >
          <span className={`narrative-suggestion-label is-${activeIssue.kind}`}>
            {issueLabel(activeIssue)} · Replace “{activeIssue.problem}”
          </span>
          <span className="narrative-suggestion-actions">
            {activeIssue.suggestions.map((suggestion) => (
              <button
                className="narrative-suggestion-option"
                key={suggestion}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => replaceRange(activeIssue, suggestion)}
              >
                {suggestion}
              </button>
            ))}
            <button
              className="narrative-suggestion-dismiss"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={ignoreActiveIssue}
            >
              Ignore once
            </button>
            {activeIssue.kind === "spelling" ? (
              <button
                className="narrative-suggestion-dismiss"
                type="button"
                disabled={dictionaryBusy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={addActiveWordToDictionary}
              >
                {dictionaryBusy ? "Adding…" : "Add to my dictionary"}
              </button>
            ) : null}
          </span>
        </span>
      ) : null}
      <span className={`narrative-correction-status ${statusMessage ? "is-visible" : ""}`}>
        <span id={statusId} role="status" aria-live="polite">{statusMessage}</span>
      </span>
    </span>
  );
});
