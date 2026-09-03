import { ChevronDown, Plus } from "@untitledui/icons";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { ProfileMenu } from "../account/ProfileMenu.jsx";
import { Button } from "../ui/Button.jsx";
import "./workspace-create-actions.css";

export function WorkspaceCreateActions({
  actor,
  onCreateWorkorder,
  onCreateInspection,
  createLabel = "Create workorder",
  locale = "en",
}) {
  const actions = [
    onCreateWorkorder ? { id: "workorder", label: "Workorder", onAction: onCreateWorkorder } : null,
    onCreateInspection ? { id: "inspection", label: "Inspection", onAction: onCreateInspection } : null,
  ].filter(Boolean);

  if (!actions.length) return <ProfileMenu actor={actor} mobileAction locale={locale} />;

  const createAction = actions.length === 1 ? (
    <Button type="button" variant="primary" icon={Plus} onClick={actions[0].onAction}>
      {actions[0].id === "workorder" ? createLabel : "Create inspection"}
    </Button>
  ) : (
    <MenuTrigger>
      <AriaButton className="button primary workspace-create-trigger" aria-label="Create">
        <Plus aria-hidden="true" />
        <span>Create</span>
        <ChevronDown aria-hidden="true" className="workspace-create-chevron" />
      </AriaButton>
      <Popover className="workspace-create-popover" placement="bottom end">
        <Menu className="workspace-create-menu" aria-label="Create">
          {actions.map((action) => (
            <MenuItem
              className="workspace-create-menu-item"
              key={action.id}
              onAction={action.onAction}
              textValue={action.label}
            >
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );

  return (
    <>
      {createAction}
      <ProfileMenu actor={actor} mobileAction locale={locale} />
    </>
  );
}
