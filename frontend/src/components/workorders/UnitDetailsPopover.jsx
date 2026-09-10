import { ChevronDown } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";

export function UnitDetailsPopover({ children, title, open, onToggle }) {
  return (
    <div className="workorder-unit-popover">
      <DialogTrigger isOpen={open} onOpenChange={onToggle}>
        <Button className="workorder-unit-details-trigger" aria-label={title}><ChevronDown aria-hidden="true" /></Button>
        <Popover className="workorder-unit-details-popover" placement="bottom end" offset={4}>
          <Dialog aria-label={title}>{children}</Dialog>
        </Popover>
      </DialogTrigger>
    </div>
  );
}
