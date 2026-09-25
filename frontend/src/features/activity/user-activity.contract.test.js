import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("global user activity reuses the shared timeline and is reachable from the account menu", async () => {
  const [dialog, profile, adminShell, css] = await Promise.all([
    readFile(new URL("./UserActivityDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/account/ProfileMenu.jsx", import.meta.url), "utf8"),
    readFile(new URL("../admin/workspace/AdminWorkspaceShell.jsx", import.meta.url), "utf8"),
    readFile(new URL("./user-activity.css", import.meta.url), "utf8"),
  ]);
  assert.match(dialog, /ModalFrame/);
  assert.match(dialog, /<IconButton className="user-activity-close-button" icon=\{XClose\} label="Close activity"/);
  assert.doesNotMatch(dialog, /Your recorded work across inventory/);
  assert.match(dialog, /<header className="user-activity-dialog-header">[\s\S]*<div className="user-activity-toolbar">[\s\S]*<\/header>\s*<div className="user-activity-dialog-body">/);
  assert.match(dialog, /setState\(beginUserActivityLoad\)/);
  assert.match(dialog, /user-activity-results\$\{state\.loading \? " is-updating" : ""\}/);
  assert.match(dialog, /aria-busy=\{state\.loading\}/);
  assert.match(css, /\.user-activity-close-button:hover:not\(:disabled\) \{ color: #d92d20; \}/);
  assert.match(css, /\.user-activity-results\.is-updating \{ pointer-events: none; \}/);
  assert.match(dialog, /WorkorderTimelineList/);
  assert.match(dialog, /api\/activity/);
  assert.match(dialog, /USER_ACTIVITY_CATEGORIES/);
  assert.match(dialog, /Load more/);
  assert.match(profile, /account\.activity/);
  assert.match(profile, /<UserActivityDialog/);
  assert.doesNotMatch(profile, /location\.assign\([^)]*activity/);
  assert.doesNotMatch(adminShell, />Activity<|view === "activity"/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /min-width: 0/);
});
