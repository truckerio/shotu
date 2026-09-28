import { ChevronDown } from "@untitledui/icons";
import { useId, useState } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader.jsx";
import "./role-navigation-rail.css";

function visible(items = []) { return items.filter((item) => item.visible !== false); }

export function RoleNavigationRail({ actor, locale = "en", ariaLabel = "Workspace", groups = [], items = [], activeId = "", onNavigate }) {
  const [openGroups, setOpenGroups] = useState(() => new Set(groups.map((group) => group.id)));
  const railId = useId();

  function toggleGroup(groupId) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const renderItem = (item) => {
    const Icon = item.icon;
    const active = item.id === activeId;
    return <button key={item.id} type="button" className={`${active ? "active" : ""}${item.variant ? ` role-navigation-item-${item.variant}` : ""}`} aria-current={active ? "page" : undefined} onClick={() => onNavigate(item.id)}>{Icon ? <Icon aria-hidden="true" /> : null}<span>{item.label}</span></button>;
  };
  return <aside className="role-navigation-rail">
    <WorkspaceHeader actor={actor} locale={locale} className="role-navigation-account" />
    <div className="role-navigation-divider" />
    <nav className="role-navigation-list" aria-label={ariaLabel}>
      {groups.map((group) => {
        const groupItems = visible(group.items);
        if (!groupItems.length) return null;
        const open = openGroups.has(group.id);
        const regionId = `${railId}-${group.id}`;
        return <section key={group.id}>
          <button className="role-navigation-group" type="button" aria-controls={regionId} aria-expanded={open} onClick={() => toggleGroup(group.id)}><span>{group.label}</span><ChevronDown aria-hidden="true" /></button>
          {open ? <div id={regionId} className="role-navigation-children">{groupItems.map(renderItem)}</div> : null}
        </section>;
      })}
      {visible(items).map(renderItem)}
    </nav>
  </aside>;
}
