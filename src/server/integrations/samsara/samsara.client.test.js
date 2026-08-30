import assert from "node:assert/strict";
import test from "node:test";
import { SamsaraApiError, SamsaraClient } from "./samsara.client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("identity paging stays on stable fleet endpoints and tag paging is bounded", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url));
    return jsonResponse({ data: [], pagination: { endCursor: "next-page" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new SamsaraClient({ token: "test-only-token", baseUrl: "https://samsara.test" });
  const vehiclePage = await client.listVehiclesPage({ after: "vehicle-cursor" });
  await client.listTrailersPage({ after: "trailer-cursor" });
  await client.listTagsPage({ after: "tag-cursor", limit: 999 });
  await client.listTagsPage({ limit: 0 });

  assert.deepEqual(vehiclePage, { data: [], pagination: { endCursor: "next-page" } });
  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.map((request) => ({
      path: request.pathname,
      after: request.searchParams.get("after"),
      limit: request.searchParams.get("limit"),
    })),
    [
      { path: "/fleet/vehicles", after: "vehicle-cursor", limit: "512" },
      { path: "/fleet/trailers", after: "trailer-cursor", limit: "512" },
      { path: "/tags", after: "tag-cursor", limit: "512" },
      { path: "/tags", after: null, limit: "1" },
    ],
  );
  assert.equal(requests.every((request) => !request.toString().includes("test-only-token")), true);
});

test("tag paging preserves provider scope failures through the API error path", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: "missing_scope" }, 403);
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new SamsaraClient({ token: "test-only-token", baseUrl: "https://samsara.test" });
  await assert.rejects(
    () => client.listTagsPage(),
    (error) => error instanceof SamsaraApiError && error.status === 403 && error.code === "missing_scope",
  );
});
