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
        textValue: optionText(child.props.children),
        value: String(value),
      });
      return;
    }
    collectOptions(child.props.children, entries);
  });
  return entries;
}

export function Dropdown({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-required": ariaRequired,
  autoFocus = false,
  children,
  className = "",
  disabled = false,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  required = false,
  style,
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
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={joinClassNames("dropdown-select", className)}
      isDisabled={disabled}
      isInvalid={Boolean(ariaInvalid)}
      isRequired={required || Boolean(ariaRequired)}
      name={name}
      onBlur={onBlur}
      onFocus={onFocus}
      onSelectionChange={changeSelection}
      selectedKey={selectedKey}
    >
      <Button
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        autoFocus={autoFocus}
        className={joinClassNames("dropdown-select-trigger", className)}
        id={id}
        style={style}
      >
        <SelectValue className="dropdown-select-value">
          {({ selectedText }) => selectedText}
        </SelectValue>
        <ChevronDown className="dropdown-select-chevron" aria-hidden="true" />
      </Button>
      <Popover className="dropdown-select-popover" placement="bottom start">
        <ListBox className="dropdown-select-listbox" items={options}>
          {(option) => (
            <ListBoxItem
              className="dropdown-select-option"
              id={option.key}
              isDisabled={option.disabled}
              textValue={option.textValue}
            >
              <span>{option.label}</span>
              <Check className="dropdown-select-check" aria-hidden="true" />
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
