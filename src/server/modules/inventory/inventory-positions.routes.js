import {
  readInventoryPositions, createInventoryPosition, updateInventoryPosition,
  readPartPositions, readPositionStock, moveInventoryPosition, startPositionCount,
  readPositionCount, recordPositionCount, recordPositionCountFoundPart, recordPositionCountIdentity, submitPositionCount, applyPositionCount,
} from "./inventory-positions.service.js";

// Errors are handled by the canonical inventory route boundary.
export async function handleInventoryPositionsApi(req, res, url, helpers, dependencies = {}) {
  const { requestContext: context, sendJson, readBody } = helpers;
  let match = /^\/api\/office\/inventory\/locations\/([^/]+)\/positions$/.exec(url.pathname);
  if (match && ["GET", "POST"].includes(req.method)) {
    const id = decodeURIComponent(match[1]);
    const result = req.method === "GET"
      ? await readInventoryPositions(id, context, dependencies)
      : await createInventoryPosition(id, await readBody(req), context, dependencies);
    sendJson(res, req.method === "GET" ? 200 : 201, result);
    return true;
  }
  match = /^\/api\/office\/inventory\/positions\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "PATCH") {
    sendJson(res, 200, await updateInventoryPosition(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/locations\/([^/]+)\/positions\/([^/]+)\/stock$/.exec(url.pathname);
  if (match && req.method === "GET") {
    sendJson(res, 200, await readPositionStock(decodeURIComponent(match[1]), decodeURIComponent(match[2]), url.searchParams.get("scope"), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/positions(\/moves)?$/.exec(url.pathname);
  if (match && ((req.method === "GET" && !match[3]) || (req.method === "POST" && match[3]))) {
    const partId = decodeURIComponent(match[1]);
    const locationId = decodeURIComponent(match[2]);
    const result = req.method === "GET"
      ? await readPartPositions(partId, locationId, context, dependencies)
      : await moveInventoryPosition(partId, locationId, await readBody(req), context, dependencies);
    sendJson(res, 200, result);
    return true;
  }
  match = /^\/api\/office\/inventory\/locations\/([^/]+)\/position-counts$/.exec(url.pathname);
  if (match && req.method === "POST") {
    sendJson(res, 201, await startPositionCount(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "GET") {
    sendJson(res, 200, await readPositionCount(decodeURIComponent(match[1]), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)\/lines\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "PUT") {
    sendJson(res, 200, await recordPositionCount(decodeURIComponent(match[1]), decodeURIComponent(match[2]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)\/found-parts$/.exec(url.pathname);
  if (match && req.method === "POST") {
    sendJson(res, 200, await recordPositionCountFoundPart(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)\/identities$/.exec(url.pathname);
  if (match && req.method === "PUT") {
    sendJson(res, 200, await recordPositionCountIdentity(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)\/submit$/.exec(url.pathname);
  if (match && req.method === "POST") {
    sendJson(res, 200, await submitPositionCount(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  match = /^\/api\/office\/inventory\/position-counts\/([^/]+)\/apply$/.exec(url.pathname);
  if (match && req.method === "POST") {
    sendJson(res, 200, await applyPositionCount(decodeURIComponent(match[1]), await readBody(req), context, dependencies));
    return true;
  }
  return false;
}
