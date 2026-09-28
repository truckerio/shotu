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
  assert.doesNotMatch(source, /LayoutLeft|role-navigation-collapse|Collapse navigation|Expand navigation/);
});

test("RoleNavigationRail keeps a flush workspace rail and phone-safe targets", () => {
  assert.match(styles, /border-right:\s*1px solid #e4e7ec/);
  assert.doesNotMatch(styles, /box-shadow/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /@media \(max-width:700px\)/);
  assert.match(styles, /@media \(max-width:700px\) \{ \.role-navigation-rail \{ display:none; \} \}/);
});

test("RoleNavigationRail supports an icon-free top-level parent destination", () => {
  assert.match(source, /role-navigation-item-\$\{item\.variant\}/);
  assert.match(styles, /\.role-navigation-item-parent/);
  assert.doesNotMatch(styles, /\.role-navigation-list \.role-navigation-item-parent::before/);
  assert.doesNotMatch(source, /data-marker=/);
});

test("RoleNavigationRail stays expanded without a collapse control", () => {
  assert.doesNotMatch(source, /collapsed|setCollapsed|navigationId/);
  assert.doesNotMatch(styles, /role-navigation-collapse|is-collapsed/);
  assert.match(source, /className="role-navigation-rail"/);
  assert.match(source, /const open = openGroups\.has\(group\.id\)/);
  assert.match(source, /onClick=\{\(\) => toggleGroup\(group\.id\)\}/);
  assert.match(styles, /\.role-navigation-account \.profile-menu\s*\{[^}]*min-width:0;[^}]*width:100%;/s);
  assert.match(styles, /\.role-navigation-account\s*\{[^}]*height:44px;[^}]*min-height:44px;/s);
  assert.match(styles, /\.role-navigation-account \.profile-menu-trigger\s*\{[^}]*height:44px;[^}]*min-height:44px;[^}]*padding-right:10px;/s);
  assert.match(styles, /\.role-navigation-account \.profile-menu-trigger > svg\s*\{[^}]*flex:0 0 auto;[^}]*margin-left:auto;/s);
});

test("shared desktop role shells use the compact 220px rail", () => {
  for (const shellStyles of [officeStyles, adminStyles, mechanicStyles, surveillanceStyles]) {
    assert.match(shellStyles, /grid-template-columns:\s*220px minmax\(0, 1fr\);/);
    assert.doesNotMatch(shellStyles, /grid-template-columns:\s*244px minmax\(0, 1fr\);/);
  }
});
