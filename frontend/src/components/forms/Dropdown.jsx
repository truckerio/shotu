import { Children, isValidElement } from "react";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import { Check, ChevronDown } from "@untitledui/icons";
import { joinClassNames } from "./form-utils.js";
import "./dropdown.css";

const EMPTY_VALUE_KEY = "dropdown-value-empty";

function optionKey(value) {
  return value === "" ? EMPTY_VALUE_KEY : `dropdown-value-${String(value)}`;
}

function optionText(children) {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement(child)) return optionText(child.props.children);
    return "";
  }).join("").trim();
}

function collectOptions(children, entries = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const value = child.props.value ?? optionText(child.props.children);
      entries.push({
        disabled: Boolean(child.props.disabled),
        key: optionKey(value),
        label: child.props.children,
        description: child.props["data-description"] || "",
        textValue: [optionText(child.props.children), child.props["data-description"]].filter(Boolean).join(" "),
        value: String(value),
      });
      return;
    }
    collectOptions(child.props.children, entries);
  });
  return entries;
}

export function DropdownTrigger({ component: Trigger = "button", className = "", icon: TriggerIcon, title, children, ...props }) {
  return <Trigger className={joinClassNames("dropdown-select-trigger", className)} {...props}>
    {TriggerIcon ? <span className="dropdown-select-trigger-icon" title={title}><TriggerIcon aria-hidden="true" /></span> : null}
    {children}
    {TriggerIcon ? null : <ChevronDown className="dropdown-select-chevron" aria-hidden="true" />}
  </Trigger>;
}

export function Dropdown({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-required": ariaRequired,
  appearance = "field",
  autoFocus = false,
  children,
  className = "",
  disabled = false,
  id,
  icon: TriggerIcon,
  name,
  onBlur,
  onChange,
  onFocus,
  placement = "bottom start",
  popoverClassName = "",
  required = false,
  showSelectionIndicator = true,
  style,
  title,
  value = "",
}) {
  const options = collectOptions(children);
  const selectedKey = optionKey(value);

  function changeSelection(key) {
    const option = options.find((entry) => entry.key === key);
    if (!option) return;
    const target = { name, value: option.value };
    onChange?.({ currentTarget: target, target });
  }

  return (
    <Select
      data-appearance={appearance}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={joinClassNames("dropdown-select", TriggerIcon && "dropdown-select-icon-only", className)}
      isDisabled={disabled}
      isInvalid={Boolean(ariaInvalid)}
      isRequired={required || Boolean(ariaRequired)}
      name={name}
      onBlur={onBlur}
      onFocus={onFocus}
      onSelectionChange={changeSelection}
      selectedKey={selectedKey}
    >
      <DropdownTrigger
        component={Button}
        icon={TriggerIcon}
        title={title}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        autoFocus={autoFocus}
        className={className}
        id={id}
        style={style}
      >
        <SelectValue className={TriggerIcon ? "dropdown-select-icon-value" : "dropdown-select-value"}>
          {({ selectedText }) => selectedText}
        </SelectValue>
      </DropdownTrigger>
      <Popover className={joinClassNames("dropdown-select-popover", !showSelectionIndicator && "is-priced", popoverClassName)} placement={placement}>
        <ListBox className="dropdown-select-listbox" items={options}>
          {(option) => (
            <ListBoxItem
              className="dropdown-select-option"
              id={option.key}
              isDisabled={option.disabled}
              textValue={option.textValue}
            >
              <span className="dropdown-select-option-label">{option.label}</span>
              {option.description ? <span className="dropdown-select-option-description">{option.description}</span> : null}
              {showSelectionIndicator ? <Check className="dropdown-select-check" aria-hidden="true" /> : null}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
