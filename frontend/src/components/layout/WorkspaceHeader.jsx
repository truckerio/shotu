import { ProfileMenu } from "../account/ProfileMenu.jsx";
import "./workspace-header.css";

export function WorkspaceHeader({ actor, children, className = "", locale = "en" }) {
  return (
    <header className={`workspace-header ${className}`.trim()}>
      <ProfileMenu actor={actor} compactOnPhone locale={locale} />
      {children ? <div className="workspace-header-actions">{children}</div> : null}
    </header>
  );
}
