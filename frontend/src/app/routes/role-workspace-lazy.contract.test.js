import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outletUrl = new URL("./RoleWorkspaceOutlet.jsx", import.meta.url);
const workspaces = [
  ["CreateWorkorderPage", "create-workorder/CreateWorkorderPage.jsx"],
  ["MechanicWorkspace", "mechanic/MechanicWorkspace.jsx"],
  ["OfficeWorkspace", "office/OfficeWorkspace.jsx"],
  ["SurveillanceWorkspace", "surveillance/SurveillanceWorkspace.jsx"],
  ["WorkorderDetailPage", "workorder-detail/WorkorderDetailPage.jsx"],
  ["InventoryScanWorkspace", "inventory/InventoryScanWorkspace.jsx"],
];

test("each optional workspace loads its named export on demand", async () => {
  const source = await readFile(outletUrl, "utf8");
  for (const [name, path] of workspaces) {
    assert.match(source, new RegExp(`const ${name} = lazy\\(\\(\\) => import\\("\\.\\./\\.\\./features/${path.replaceAll(".", "\\.")}\\"\\)\\s*\\.then\\(\\(module\\) => \\(\\{ default: module\\.${name} \\}\\)\\)\\);`), name);
    assert.doesNotMatch(source, new RegExp(`import \\{ ${name} \\} from`), `${name} must stay out of the eager app chunk`);
  }
});

test("every lazy route has a loading boundary and retains route precedence", async () => {
  const source = await readFile(outletUrl, "utf8");
  const branches = [
    ["inventoryScan", "if (new URLSearchParams(window.location.search).has(\"inventoryScan\"))", "InventoryScanWorkspace"],
    ["mechanic", 'if (workspace === "mechanic")', "MechanicWorkspace"],
    ["admin", 'if (workspace === "admin")', "AdminWorkspace"],
    ["office", 'if (workspace === "office")', "OfficeWorkspace"],
    ["surveillance", 'if (workspace === "surveillance")', "SurveillanceWorkspace"],
    ["detail", "if (activeWorkorder)", "WorkorderDetailPage"],
  ];
  for (const [label, start, component] of branches) {
    const branch = source.slice(source.indexOf(start), source.indexOf("\n  }", source.indexOf(start)));
    assert.ok(branch.startsWith(start), `${label} branch must exist`);
    assert.match(branch, /<Suspense fallback=\{<AppLoadingFallback \/>\}>/, `${label} must show the loading fallback`);
    assert.match(branch, new RegExp(`<${component}(?:\\s|\\/)`), `${label} must render its workspace`);
    assert.match(branch, /<\/Suspense>/, `${label} must close its loading boundary`);
  }
  assert.ok(source.indexOf('has("inventoryScan")') < source.indexOf("if (routeLoading)"));
  assert.ok(source.indexOf("if (routeLoading)") < source.indexOf('if (workspace === "mechanic")'));
  assert.ok(source.indexOf("if (activeWorkorder)") < source.indexOf("if (!navigation.canOpenCreateWorkspace)"));
  const unavailable = source.slice(source.indexOf("if (!navigation.canOpenCreateWorkspace)"));
  assert.match(unavailable, /create\.unavailable/);
  assert.match(unavailable, /return withPhoneProfile\(<Suspense fallback=\{<AppLoadingFallback \/>\}><CreateWorkorderPage \{\.\.\.createPageProps\} \/><\/Suspense>\);/);
  assert.match(source, /<nav className="role-phone-profile-dock" aria-label="Profile navigation">\s*<ProfileMenu actor=\{actor\} locale=\{locale\} mobileNav \/>/);
});

test("phone profile shares the existing Create and detail bottom dock", async () => {
  const styles = await readFile(new URL("./role-phone-profile-dock.css", import.meta.url), "utf8");
  assert.match(styles, /:has\(\.workorder-section-nav-mobile, \.create-workorder-mobile-dock\) \.role-phone-profile-dock/);
  assert.match(styles, /\.role-phone-profile-layout \.create-workorder-mobile-dock \{ padding-right: max\(16\.6667%, 64px\); \}/);
  assert.match(styles, /:has\(\.create-workorder-mobile-dock\[data-keyboard-open="true"\]\) \.role-phone-profile-dock/);
  assert.match(styles, /\.role-phone-product-switch \{[\s\S]*?position: fixed;/);
});
