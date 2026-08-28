import { Plus } from "@untitledui/icons";
import { ProfileMenu } from "../account/ProfileMenu.jsx";
import { Button } from "../ui/Button.jsx";

export function WorkspaceCreateActions({ actor, onCreateWorkorder, createLabel = "Create workorder", locale = "en" }) {
  if (!onCreateWorkorder) return <ProfileMenu actor={actor} mobileAction locale={locale} />;

  return (
    <>
      <Button type="button" variant="primary" icon={Plus} onClick={onCreateWorkorder}>{createLabel}</Button>
      <ProfileMenu actor={actor} mobileAction locale={locale} />
    </>
  );
}
