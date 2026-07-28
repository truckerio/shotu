import { Plus } from "@untitledui/icons";
import { ProfileMenu } from "../account/ProfileMenu.jsx";
import { Button } from "../ui/Button.jsx";

export function WorkspaceCreateActions({ actor, onCreateWorkorder }) {
  return (
    <>
      <Button type="button" variant="primary" icon={Plus} onClick={onCreateWorkorder}>Create workorder</Button>
      <ProfileMenu actor={actor} mobileAction />
    </>
  );
}
