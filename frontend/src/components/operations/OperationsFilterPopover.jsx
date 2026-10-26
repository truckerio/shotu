import { FilterLines } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import "./operations-filter-popover.css";

export function OperationsFilterPopover({ label, active, column = false, children }) {
  return <DialogTrigger>
    <Button className={`operations-filter-trigger${column ? " is-column" : ""}${active ? " is-active" : ""}`} aria-label={column ? `${label} filters and sort` : label}>
      {column ? <span>{label}</span> : null}<FilterLines aria-hidden="true" />
    </Button>
    <Popover className="operations-filter-popover" placement="bottom end" offset={8}>
      <Dialog aria-label={label}>{({ close }) => <>
        <header><h3>{label}</h3><Button onPress={close}>Done</Button></header>
        <div className="operations-filter-fields">{children}</div>
      </>}</Dialog>
    </Popover>
  </DialogTrigger>;
}
