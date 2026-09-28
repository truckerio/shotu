import { Check, ChevronDown } from "@untitledui/icons";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import "./operations-view-title.css";

export const OPERATIONS_VIEWS = [
  { id: "workorders", label: "Workorders", description: "Manage repair work" },
  { id: "inspections", label: "Inspections", description: "Review scheduled checks" },
];

export function OperationsViewTitle({ product, canSwitch, onChange }) {
  const selected = OPERATIONS_VIEWS.find((view) => view.id === product) || OPERATIONS_VIEWS[0];

  if (!canSwitch) return selected.label;

  return (
    <MenuTrigger>
      <AriaButton className="operations-page-title-trigger" aria-label={`Current view: ${selected.label}`}>
        <span>{selected.label}</span>
        <ChevronDown aria-hidden="true" />
      </AriaButton>
      <Popover className="operations-page-title-popover" placement="bottom start">
        <Menu className="operations-page-title-menu" aria-label="Choose Operations view" onAction={onChange}>
          {OPERATIONS_VIEWS.map((view) => (
            <MenuItem className="operations-page-title-menu-item" id={view.id} key={view.id} textValue={view.label} aria-current={product === view.id ? "page" : undefined}>
              <span><strong>{view.label}</strong><small>{view.description}</small></span>
              {product === view.id ? <Check aria-hidden="true" /> : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
