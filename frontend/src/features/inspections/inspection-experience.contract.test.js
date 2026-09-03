import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readInspectionSession, writeInspectionSession } from "./inspection-session-state.js";

const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");

test("autosave conflict reloads the authoritative version and leaves an explicit retry route", () => {
  assert.match(experience, /error\?\.status === 409/);
  assert.match(experience, /await reloadActive\(\)\.catch/);
  assert.match(detail, /setRetryPayload\(\{ item, value \}\)/);
  assert.match(detail, /Retry save/);
  assert.match(detail, /Reload latest/);
  assert.match(detail, /const latest = await onReload\?\./);
  assert.match(detail, /setResponses\(latest\.responses \|\| \{\}\)/);
});

test("a saved issue immediately receives its durable finding identity", () => {
  assert.match(experience, /activeRef\.current = next; setActive\(next\);\s*return next;/);
  assert.match(detail, /const persistedFindingId = saved\?\.responses\?\.\[item\.key\]\?\.findingId/);
  assert.match(detail, /findingId: persistedFindingId/);
});

test("opening an assigned inspection leaves lifecycle start to the explicit detail action", () => {
  assert.doesNotMatch(experience, /projection === "mechanic"[\s\S]*\/actions\/start/);
  assert.match(experience, /async function startInspection\(input\)/);
  assert.match(experience, /onStart=\{activeInspectionAccess\.canWrite/);
});

test("full projections have compact lifecycle filters while read-only exposes the operator status choices", () => {
  assert.match(experience, /<OperationalCollectionTabs/);
  assert.match(experience, /id: "needs_action", label: "Needs action"/);
  assert.match(experience, /id: "in_progress", label: "In progress"/);
  assert.match(experience, /id: "completed", label: "Completed"/);
  assert.match(experience, /<option value="">All<\/option><option value="completed">Completed<\/option><option value="not_completed">Not completed<\/option>/);
  assert.match(experience, /\["needs_action", "completed", "in_progress", "not_completed"\]\.includes\(status\)/);
  assert.match(experience, /activeId=\{status\}/);
  assert.match(experience, /nextCursor/);
  assert.match(experience, /Load more inspections/);
  assert.match(experience, /params\.set\("status", status\)/);
});

test("detail shows office instructions only to authorized operational projections", () => {
  assert.match(detail, /inspection\.officeInstructions && !restrictedReadOnly/);
  assert.match(detail, /aria-label="Office instructions"/);
});

test("printing and workorder findings cross their durable inspection APIs", () => {
  assert.match(experience, /\/print-archives/);
  assert.match(experience, /await renderAndPrintInspectionSlip\(popup, result\.html\)/);
  assert.match(experience, /result\.archive\?\.downloadUrl/);
  assert.match(experience, /popup\.location\.replace\(result\.archive\.downloadUrl\)/);
  assert.match(detail, />Download PDF<\/Button>/);
  assert.match(experience, /api\(`\/api\/inspections\/\$\{encodeURIComponent\(current\.id\)\}\/workorders`, \{/);
  assert.match(experience, /method: "POST"/);
  assert.match(experience, /expectedVersion: current\.version, findingIds, idempotencyKey:/);
  assert.match(experience, /const next = inspectionFromApi\(result\.inspection\)/);
  assert.match(experience, /\/findings\/\$\{encodeURIComponent\(findingId\)\}\/workorder-links/);
  assert.match(detail, /Existing workorder/);
  assert.match(detail, /workorderFindings\.length > 0/);
});

test("workorders-disabled mechanics receive only dispositions they can complete", () => {
  assert.match(detail, /workorderActionsAuthorized \? dispositions : dispositions\.filter/);
  assert.match(detail, /!\["new_workorder", "linked_workorder"\]\.includes\(key\)/);
  assert.match(experience, /workorderActionsAuthorized=\{activeWorkorderAccess\.canWrite\}/);
});

test("inspection workorder creation is atomic, retry-safe, and does not open the generic create form", () => {
  assert.match(experience, /response\.disposition === "new_workorder" && response\.findingId/);
  assert.match(experience, /const findingIds = findings\.map\(\(response\) => response\.findingId\)\.sort\(\)/);
  assert.match(experience, /workorderCreateRequests\.current\.has\(requestIdentity\)/);
  assert.match(experience, /workorderCreateKeys\.current\.set\(requestIdentity, `inspection-workorder-\$\{crypto\.randomUUID\(\)\}`\)/);
  assert.match(experience, /workorderCreateRequests\.current\.set\(requestIdentity, request\)/);
  assert.match(experience, /setState\(\(value\) => \(\{ \.\.\.value, error: error\.message \}\)\)/);
  assert.doesNotMatch(experience, /onCreateWorkorder\?\.\(\{ inspectionId:/);
});

test("mixed workorder dispositions cannot silently route linked-only findings through creation", () => {
  assert.match(detail, /selectedNewWorkorderFindings = selectedFindings\.filter\(\(finding\) => finding\.disposition === "new_workorder"\)/);
  assert.match(detail, /if \(!selectedNewWorkorderFindings\.length\) return/);
  assert.match(detail, /Existing workorder required/);
  assert.match(detail, /must be linked by Office before completion/);
});

test("eligible-workorder failures leave loading and expose an unavailable recovery state", () => {
  assert.match(experience, /setEligibleWorkorders\(false\)/);
  assert.match(detail, /workorderEligibilityLoading = eligibleWorkorders == null/);
  assert.match(detail, /workorderEligibilityUnavailable = eligibleWorkorders === false/);
  assert.match(detail, /Active workorders are unavailable\. Reload the inspection or ask Office/);
});

test("detail exposes keyboard-reachable next unchecked navigation and Office/Admin assignment without native selects", () => {
  assert.match(detail, /id=\{`inspection-check-\$\{item\.key\}`\}/);
  assert.match(detail, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(detail, /Next unchecked/);
  assert.match(detail, /<Dropdown aria-label="Assign mechanic"/);
  assert.doesNotMatch(detail, /<select/);
});

test("inspection session state safely preserves queue state across an unmount/remount", () => {
  const previousWindow = globalThis.window;
  const entries = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) } };
  try {
    writeInspectionSession("office", { search: "125", status: "needs_action", activeId: "inspection-1", scrollY: 240 });
    assert.deepEqual(readInspectionSession("office"), { search: "125", status: "needs_action", activeId: "inspection-1", scrollY: 240 });
  } finally { globalThis.window = previousWindow; }
});

test("queue scroll is captured before detail and restored after Back without resuming a stale detail", () => {
  assert.match(experience, /const queueScrollY = useRef\(initialSession\.scrollY\)/);
  assert.match(experience, /queueScrollY\.current = window\.scrollY/);
  assert.match(experience, /function returnToQueue\(\)/);
  assert.match(experience, /activeId: "", scrollY: queueScrollY\.current/);
  assert.match(experience, /window\.scrollTo\(\{ top: queueScrollY\.current \}\)/);
  assert.match(experience, /const queueFocusRef = useRef\(null\)/);
  assert.match(experience, /queueFocusRef\.current\?\.querySelector\("input"\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(experience, /onBack=\{returnToQueue\}/);
});

test("mixed-location access derives every inspection action from the record location", () => {
  assert.match(experience, /productModuleCapabilities\(actor, "inspections", result\.inspection\.locationId\)/);
  assert.match(experience, /productModuleCapabilities\(actor, "workorders", result\.inspection\.locationId\)/);
  assert.match(experience, /productModuleCapabilities\(actor, "inspections", inspection\.locationId\)/);
  assert.match(experience, /productModuleCapabilities\(actor, "inspections", active\?\.locationId\)/);
  assert.match(experience, /productModuleCapabilities\(actor, "workorders", active\?\.locationId\)/);
  assert.match(experience, /!activeInspectionAccess\.canWrite \? "read_only"/);
});

test("visible inspection queues refresh automatically without overwriting active detail work", () => {
  assert.match(experience, /inspectionRefreshMode\(refreshCycle\.current\)/);
  assert.match(experience, /enabled: !active, intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS/);
  assert.match(experience, /createLatestRequestGuard\(\)/);
  assert.match(experience, /loadGeneration\.current\.begin\(\)/);
  assert.match(experience, /loadGeneration\.current\.isCurrent\(generation\)/);
  assert.match(experience, /foregroundLoads\.current > 0/);
  assert.match(experience, /abortBackgroundLoad\.current\?\.\(\)/);
  assert.match(experience, /loadInspectionRefreshWindow/);
  assert.match(experience, /loadedCount: Math\.max\(loadedItemCount\.current, 25\)/);
  assert.match(experience, /items\.length < MAX_LIVE_INSPECTION_ROWS/);
});
