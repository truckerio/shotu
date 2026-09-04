import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("./OfficeWorkspace.jsx", import.meta.url);

test("Office Parts uses the shared request queue and opens the exact request", async () => {
  const source = await readFile(workspaceUrl, "utf8");

  assert.match(source, /import \{ PartRequestQueue \} from "\.\.\/\.\.\/components\/operations\/PartRequestQueue\.jsx"/);
  assert.match(source, /activeTab === "parts" \? \(/);
  assert.match(source, /<PartRequestQueue/);
  assert.match(source, /onOpenWorkorder=\{openDetail\}/);
  assert.match(source, /await onOpenWorkorder\(id, options\)/);
  assert.match(source, /import \{ usePartRequestQueueCount \} from "\.\.\/\.\.\/components\/operations\/usePartRequestQueueCount\.js"/);
  assert.match(source, /const \[partRequestRefreshKey, setPartRequestRefreshKey\] = useState\(0\);/);
  assert.match(source, /const partRequestCount = usePartRequestQueueCount\(\{ refreshKey: partRequestRefreshKey, enabled: workorderAccess\.canRead \}\);/);
  assert.match(source, /setPartRequestRefreshKey\(\(current\) => current \+ 1\)/);
  assert.match(source, /count: partRequestCount\.loaded \? partRequestCount\.total : null/);
  assert.doesNotMatch(source, /dashboard\?\.parts\?\.length/);
  assert.match(source, /refreshKey=\{partRequestRefreshKey\}/);
  assert.match(source, /\["drafts", "inventory", "units", "parts"\]\.includes\(activeTab\)/);
});
