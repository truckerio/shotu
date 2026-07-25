import { ProfileMenu } from "../account/ProfileMenu.jsx";
import "./workspace-header.css";

export function WorkspaceHeader({ actor, children, className = "" }) {
  return (
    <header className={`workspace-header ${className}`.trim()}>
      <ProfileMenu actor={actor} />
      {children ? <div className="workspace-header-actions">{children}</div> : null}
    </header>
  );
}
