import { DotsVertical } from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import "./part-row-actions.css";

export function PartRowActions({ label, actions, disabled = false }) {
  const available = actions.filter(Boolean);
  if (!available.length) return null;
  return <MenuTrigger>
    <Button type="button" className="part-row-more-trigger" aria-label={label} isDisabled={disabled}>
      <DotsVertical aria-hidden="true" />
    </Button>
    <Popover className="part-row-more-popover" placement="bottom end" offset={6}>
      <Menu aria-label={label} items={available}>
        {(action) => <MenuItem id={action.id} textValue={action.label} onAction={action.onAction}>{action.label}</MenuItem>}
      </Menu>
    </Popover>
  </MenuTrigger>;
}
