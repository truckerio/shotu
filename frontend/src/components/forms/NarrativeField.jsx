import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { RichTextarea, experimental_RichInput as RichInput } from "rich-textarea";
import { checkNarrativeSpelling } from "./narrative-spellcheck-engine.js";
import { textEntryProps } from "./text-entry-policy.js";
import "./narrative-field.css";

const CHECK_DELAY_MS = 280;

function highlightedText(text, issues, onActivate) {
  if (!issues.length) return text;
  const content = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.start > cursor) content.push(text.slice(cursor, issue.start));
    content.push(
      <span
        className="narrative-spelling-error"
        key={`${issue.start}-${issue.end}`}
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

export const NarrativeField = forwardRef(function NarrativeField(
  {
    className = "",
    onBlur,
    onChange,
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
  const requestRef = useRef(0);
  const [activeIssue, setActiveIssue] = useState(null);
  const [focused, setFocused] = useState(false);
  const [issues, setIssues] = useState([]);
  const [providerAvailable, setProviderAvailable] = useState(null);
  const text = String(value || "");

  useImperativeHandle(forwardedRef, () => controlRef.current);

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!focused || text.trim().length < 3) {
      if (text.trim().length < 3) {
        setIssues([]);
        setActiveIssue(null);
      }
      return undefined;
    }
    const timer = setTimeout(() => {
      checkNarrativeSpelling(text)
        .then((nextIssues) => {
          if (requestId !== requestRef.current) return;
          setIssues(nextIssues);
          setProviderAvailable(true);
          setActiveIssue((current) => (
            current
              ? nextIssues.find((issue) => issue.start === current.start && issue.end === current.end) || null
              : null
          ));
        })
        .catch(() => {
          if (requestId !== requestRef.current) return;
          setIssues([]);
          setProviderAvailable(false);
        });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focused, text]);

  const renderedText = useMemo(
    () => highlightedText(text, issues, setActiveIssue),
    [issues, text],
  );
  const Control = singleLine ? RichInput : RichTextarea;

  function updateActiveIssue() {
    setActiveIssue(issueAtSelection(issues, controlRef.current));
  }

  function applySuggestion(suggestion) {
    if (!activeIssue) return;
    const nextValue = `${text.slice(0, activeIssue.start)}${suggestion}${text.slice(activeIssue.end)}`;
    onChange?.({ currentTarget: { value: nextValue }, target: { value: nextValue } });
    setActiveIssue(null);
    setIssues([]);
    requestAnimationFrame(() => {
      const caret = activeIssue.start + suggestion.length;
      controlRef.current?.focus();
      controlRef.current?.setSelectionRange?.(caret, caret);
    });
  }

  return (
    <span className={`narrative-field ${singleLine ? "is-single-line" : ""}`}>
      <Control
        {...textEntryProps("narrative")}
        {...props}
        className={`narrative-field-control ${className}`.trim()}
        ref={controlRef}
        spellCheck={providerAvailable === false}
        style={{ ...style, width: style?.width || "100%" }}
        value={text}
        onBlur={(event) => {
          setFocused(false);
          setActiveIssue(null);
          onBlur?.(event);
        }}
        onChange={onChange}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
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
        <span className="narrative-suggestion-menu" role="dialog" aria-label={`Suggestions for ${activeIssue.problem}`}>
          <span className="narrative-suggestion-label">Replace “{activeIssue.problem}”</span>
          <span className="narrative-suggestion-actions">
            {activeIssue.suggestions.map((suggestion) => (
              <button
                className="narrative-suggestion-option"
                key={suggestion}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))}
            <button
              className="narrative-suggestion-dismiss"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setActiveIssue(null)}
            >
              Dismiss
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
});
