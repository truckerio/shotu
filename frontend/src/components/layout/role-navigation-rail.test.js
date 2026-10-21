import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./RoleNavigationRail.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./role-navigation-rail.css", import.meta.url), "utf8");
const officeStyles = readFileSync(new URL("../../features/office/office.css", import.meta.url), "utf8");
const adminStyles = readFileSync(new URL("../../features/admin/admin.css", import.meta.url), "utf8");
const mechanicStyles = readFileSync(new URL("../../features/mechanic/mechanic-workspace.css", import.meta.url), "utf8");
const surveillanceStyles = readFileSync(new URL("../../features/surveillance/surveillance.css", import.meta.url), "utf8");

test("RoleNavigationRail is profile-first, permission-filtered, and accessible", () => {
  assert.match(source, /<WorkspaceHeader actor=\{actor\}/);
  assert.match(source, /items\.filter\(\(item\) => item\.visible !== false\)/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{regionId\}/);
  assert.match(source, /\{open \? <div id=\{regionId\} className="role-navigation-children">/);
  assert.match(source, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(source, /<ChevronDown aria-hidden="true" \/>/);
  assert.match(source, /import \{ ChevronDown \} from "@untitledui\/icons"/);
  assert.match(source, /<WorkspaceHeader actor=\{actor\} locale=\{locale\} className="role-navigation-account" \/>/);
  assert.match(source, /aria-label=\{item.label\}/);
});

test("RoleNavigationRail keeps a flush workspace rail and phone-safe targets", () => {
  assert.match(styles, /border:\s*0/);
  assert.match(styles, /height:100dvh/);
  assert.match(styles, /overflow-y:auto/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /@media \(max-width:700px\)/);
  assert.match(styles, /@media \(max-width:700px\) \{ \.role-navigation-rail \{ display:none; \} \}/);
});

test("Admin profile divider stays straight and aligns with the page card", () => {
  assert.match(adminStyles, /\.admin-shell \.role-navigation-rail\s*\{[^}]*position:\s*sticky;/s);
  assert.match(adminStyles, /\.admin-shell \.role-navigation-rail::after\s*\{[^}]*border-top:\s*1px solid #e4e7ec;[^}]*height:\s*1px;[^}]*left:\s*10px;[^}]*right:\s*0;[^}]*top:\s*68px;/s);
  assert.doesNotMatch(adminStyles, /\.admin-shell \.role-navigation-rail::after\s*\{[^}]*(?:border-right:|border-top-right-radius:|inset:)/s);
  assert.match(adminStyles, /\.admin-shell \.role-navigation-divider\s*\{[^}]*background:\s*transparent;/s);
});

test("RoleNavigationRail supports an icon-free top-level parent destination", () => {
  assert.match(source, /role-navigation-item-\$\{item\.variant\}/);
  assert.match(styles, /\.role-navigation-item-parent/);
  assert.doesNotMatch(styles, /\.role-navigation-list \.role-navigation-item-parent::before/);
  assert.doesNotMatch(source, /data-marker=/);
});

test("compact navigation preserves permitted destinations and tablet layout space", () => {
  assert.match(source, /const open = compact \|\| openGroups.has\(group.id\)/);
  assert.match(source, /className="role-navigation-fallback" aria-hidden="true"/);
  assert.match(source, /aria-label=\{compact \? "Expand navigation" : "Collapse navigation"\}/);
  assert.match(source, /aria-controls=\{navigationId\}/);
  assert.match(source, /data-compact=\{compact\} data-overlay=\{overlay\} data-tablet=\{tablet\}/);
  assert.match(styles, /:has\(> \.role-navigation-rail\[data-tablet="true"\]\)/);
  assert.match(styles, /grid-template-columns:104px minmax\(0, 1fr\)/);
  assert.match(styles, /\[data-overlay="true"\][^}]*width:var\(--role-navigation-expanded-width/s);
});

test("tablet expansion dismisses accessibly without remounting content", () => {
  assert.match(source, /document.addEventListener\("pointerdown", outside\)/);
  assert.match(source, /document.addEventListener\("focusin", outside\)/);
  assert.match(source, /event.key === "Escape"/);
  assert.match(source, /toggleRef.current\?\.focus\(\)/);
  assert.match(source, /if \(overlay\) dismissOverlay\(true\)/);
  assert.match(source, /\.profile-menu-popover, \[role='dialog'\]/);
  assert.match(source, /TooltipTrigger key=\{item.id\} delay=\{250\} isDisabled=\{!compact\}/);
});

test("desktop role shells use compact role-appropriate rail widths", () => {
  assert.match(adminStyles, /grid-template-columns:\s*200px minmax\(0, 1fr\);/);
  for (const shellStyles of [officeStyles, mechanicStyles, surveillanceStyles]) {
    assert.match(shellStyles, /grid-template-columns:\s*220px minmax\(0, 1fr\);/);
    assert.doesNotMatch(shellStyles, /grid-template-columns:\s*244px minmax\(0, 1fr\);/);
  }
});

test("keyboard labels survive incidental list scrolling but respect dismissal", () => {
  assert.match(source, /isOpen=\{compact && tooltipOpen\} onOpenChange=\{changeTooltip\}/);
  assert.match(source, /if \(!nextOpen && keyboardFocus\.current && compact\)/);
  assert.match(source, /buttonRef\.current === document\.activeElement/);
  assert.match(source, /onBlur=\{dismissTooltip\}/);
  assert.match(source, /onPressStart=\{dismissTooltip\}/);
  assert.match(source, /event\.key === "Escape" && keyboardFocus\.current/);
  assert.match(source, /cancelAnimationFrame\(reopenFrame\.current\)/);
});
