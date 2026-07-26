import { performance } from "node:perf_hooks";
import { HttpResponseError } from "./http-client.js";
import { Metrics } from "./metrics.js";

const READ_ROUTES = {
  admin: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET operations summary", path: "/api/admin/operations/summary" },
    { label: "GET operations page", path: "/api/admin/operations/workorders?page=1&pageSize=25" },
    { label: "GET locations", path: "/api/admin/locations" },
  ],
  office: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET office dashboard", path: "/api/office/dashboard" },
  ],
  mechanic: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET mechanic dashboard", path: "/api/mechanic/dashboard" },
  ],
};

function errorStatus(error) {
  return error instanceof HttpResponseError ? error.status : 0;
}

async function readWorker({ client, role, deadline, metrics, workerIndex, signal }) {
  const routes = READ_ROUTES[role];
  let index = workerIndex;
  while (performance.now() < deadline && !signal.aborted) {
    const route = routes[index % routes.length];
    const started = performance.now();
    try {
      const result = await client.request(route.path, { signal });
      metrics.record({
        role,
        label: route.label,
        durationMs: result.durationMs,
        ok: true,
        status: result.response.status,
      });
    } catch (error) {
      metrics.record({
        role,
        label: route.label,
        durationMs: performance.now() - started,
        ok: false,
        status: errorStatus(error),
      });
    }
    index += 1;
  }
}

export async function runReadLoad({ clients, durationMs, concurrencyPerRole, signal }) {
  const metrics = new Metrics();
  const started = performance.now();
  const deadline = started + durationMs;
  const workers = [];
  for (const [role, client] of Object.entries(clients)) {
    for (let workerIndex = 0; workerIndex < concurrencyPerRole; workerIndex += 1) {
      workers.push(readWorker({
        client,
        role,
        deadline,
        metrics,
        workerIndex,
        signal,
      }));
    }
  }
  await Promise.all(workers);
  return { metrics, durationMs: performance.now() - started };
}

function loadFixture(runId, index) {
  return {
    concern: `Disposable load fixture ${runId} ${index}`,
    loadHarness: {
      schema: 1,
      runId,
      index,
      createdAt: new Date().toISOString(),
    },
  };
}

async function discardQuietly(client, id) {
  try {
    await client.request(`/api/workorder-drafts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      expectedStatuses: [200, 404, 409],
    });
    return true;
  } catch {
    return false;
  }
}

async function cleanStaleFixtures(client, actorId, staleAfterMs) {
  const result = await client.request("/api/workorder-drafts?type=workorder");
  const cutoff = Date.now() - staleAfterMs;
  const stale = (result.body?.drafts || []).filter((draft) => (
    draft.owner?.id === actorId
    && draft.payload?.loadHarness?.schema === 1
    && Date.parse(draft.payload.loadHarness.createdAt || draft.createdAt) < cutoff
  ));
  await Promise.all(stale.map((draft) => discardQuietly(client, draft.id)));
  return stale.length;
}

export async function runDraftConcurrency({
  client,
  actor,
  concurrency,
  staleAfterMs,
  signal,
}) {
  const started = performance.now();
  const runId = `load-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdIds = new Set();
  const metrics = new Metrics();
  let staleCleaned = 0;
  try {
    staleCleaned = await cleanStaleFixtures(client, actor.id, staleAfterMs);
    const created = await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const started = performance.now();
        try {
          const result = await client.request("/api/workorder-drafts", {
            method: "POST",
            body: {
              type: "workorder",
              payload: loadFixture(runId, index),
            },
            expectedStatuses: [201],
            signal,
          });
          createdIds.add(result.body.draft.id);
          metrics.record({
            role: client.role,
            label: "POST disposable draft",
            durationMs: result.durationMs,
            ok: true,
            status: 201,
          });
          return result.body.draft;
        } catch (error) {
          metrics.record({
            role: client.role,
            label: "POST disposable draft",
            durationMs: performance.now() - started,
            ok: false,
            status: errorStatus(error),
          });
          throw error;
        }
      }),
    );

    const updated = await Promise.all(
      created.map(async (draft, index) => {
        const started = performance.now();
        try {
          const result = await client.request(`/api/workorder-drafts/${draft.id}`, {
            method: "PATCH",
            body: {
              version: draft.version,
              payload: { loadHarness: { ...draft.payload.loadHarness, independentUpdate: index } },
            },
            signal,
          });
          metrics.record({
            role: client.role,
            label: "PATCH independent draft",
            durationMs: result.durationMs,
            ok: true,
            status: 200,
          });
          return result.body.draft;
        } catch (error) {
          metrics.record({
            role: client.role,
            label: "PATCH independent draft",
            durationMs: performance.now() - started,
            ok: false,
            status: errorStatus(error),
          });
          throw error;
        }
      }),
    );

    const collisionTarget = updated[0];
    const collisionResults = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => client.request(
        `/api/workorder-drafts/${collisionTarget.id}`,
        {
          method: "PATCH",
          body: {
            version: collisionTarget.version,
            payload: { loadHarnessCollision: { runId, contender: index } },
          },
          expectedStatuses: [200, 409],
          signal,
        },
      )),
    );
    const winners = collisionResults.filter((result) => result.response.status === 200).length;
    const conflicts = collisionResults.filter((result) => (
      result.response.status === 409 && result.body?.code === "DRAFT_VERSION_CONFLICT"
    )).length;
    for (const result of collisionResults) {
      metrics.record({
        role: client.role,
        label: "PATCH collision draft",
        durationMs: result.durationMs,
        ok: result.response.status === 200 || result.body?.code === "DRAFT_VERSION_CONFLICT",
        status: result.response.status,
      });
    }
    if (winners !== 1 || conflicts !== concurrency - 1) {
      throw new Error(
        `Optimistic-lock probe expected 1 winner and ${concurrency - 1} conflicts; received ${winners} and ${conflicts}.`,
      );
    }
    return {
      runId,
      staleCleaned,
      created: created.length,
      independentUpdates: updated.length,
      collisionWinners: winners,
      expectedConflicts: conflicts,
      metrics,
      durationMs: performance.now() - started,
    };
  } finally {
    const cleanup = await Promise.all([...createdIds].map((id) => discardQuietly(client, id)));
    const failures = cleanup.filter((cleaned) => !cleaned).length;
    if (failures) {
      throw new Error(`Failed to clean ${failures} disposable draft fixture(s).`);
    }
  }
}

export { READ_ROUTES };
