import { resolveRequestContext } from '../../auth/context.js';
import { inventoryCompanyReadScope } from './inventory-effective-scope.js';
import { getInventoryChangeFeed } from './inventory-change-feed.js';

const PATH = '/api/office/inventory/events';
const MAX_STREAMS_PER_ACTOR = 8;
const actorStreams = new Map();

export async function handleInventoryEventsApi(req, res, url, helpers, dependencies = {}) {
  if (url.pathname !== PATH) return false;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    helpers.sendJson(res, 405, { code: 'method_not_allowed', message: 'Method not allowed.' });
    return true;
  }

  // The caller's normal auth gate has already resolved requestContext. Reuse
  // Stock's company-wide read policy; ignore all query-supplied company IDs.
  const initial = helpers.requestContext;
  const scope = inventoryCompanyReadScope(initial);
  const actorId = initial.actor.id;
  const sessionId = initial.session?.session?.id || null;
  const count = actorStreams.get(actorId) || 0;
  if (count >= MAX_STREAMS_PER_ACTOR) {
    helpers.sendJson(res, 429, { code: 'inventory_stream_limit', message: 'Too many open inventory streams.' });
    return true;
  }
  actorStreams.set(actorId, count + 1);

  const subscribedIds = new Set(scope.companyIds);
  const feed = dependencies.feed || getInventoryChangeFeed();
  const resolveContext = dependencies.resolveRequestContext || resolveRequestContext;
  const heartbeatMs = dependencies.heartbeatMs || 15_000;
  let unsubscribe = null;
  let timer = null;
  let closed = false;
  let validating = null;
  let pendingChange = false;
  let flushing = false;
  let ready = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    unsubscribe?.();
    res.removeListener('close', cleanup);
    const remaining = (actorStreams.get(actorId) || 1) - 1;
    if (remaining) actorStreams.set(actorId, remaining);
    else actorStreams.delete(actorId);
  }

  function end() {
    cleanup();
    if (!res.writableEnded && !res.destroyed) res.end();
  }

  function write(frame) {
    if (closed || res.destroyed || res.writableEnded) return;
    try {
      if (!res.write(frame)) end(); // Do not buffer unbounded events for a slow client.
    } catch { end(); }
  }

  async function validate() {
    if (validating) return validating;
    validating = (async () => {
      const fresh = await resolveContext(req);
      if (fresh.actor?.id !== actorId || (sessionId && fresh.session?.session?.id !== sessionId)) throw new Error('Session changed');
      const freshIds = new Set(inventoryCompanyReadScope(fresh).companyIds);
      if ([...subscribedIds].some((companyId) => !freshIds.has(companyId))) throw new Error('Inventory access changed');
    })();
    try { await validating; } finally { validating = null; }
  }

  async function flushChange() {
    if (closed || !ready || !pendingChange || flushing) return;
    flushing = true;
    try {
      while (pendingChange && !closed) {
        pendingChange = false;
        await validate();
        write('event: inventory-change\ndata: {}\n\n');
      }
    } catch { end(); }
    finally { flushing = false; }
  }

  function onChange() {
    pendingChange = true;
    void flushChange();
  }

  res.on('close', cleanup);
  try {
    unsubscribe = await feed.subscribe(scope.companyIds, onChange, end);
    if (closed) { unsubscribe(); return true; }
  } catch {
    cleanup();
    if (!res.destroyed && !res.headersSent) helpers.sendJson(res, 503, {
      code: 'inventory_stream_unavailable', message: 'Inventory updates are temporarily unavailable.',
    });
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  write('event: ready\ndata: {}\n\n');
  ready = true;
  if (pendingChange) void flushChange();
  if (closed) return true;
  timer = setInterval(async () => {
    if (closed) return;
    try {
      await validate();
      write(': heartbeat\n\n');
    } catch { end(); }
  }, heartbeatMs);
  timer.unref?.();
  return true;
}
