import { invalidRequest, resourceNotFound } from "../../auth/errors.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import {
  listUnitServiceHistory,
  readServiceHistorySyncState,
} from "../../db/repositories/service-history.repo.js";
import { getOperationalWorkorderById } from "../../db/repositories/operational-workorders.repo.js";
import { authorizeWorkorderModule } from "./workorder-module-access.service.js";

const MAX_HISTORY_LIMIT = 50;
const HISTORY_FRESHNESS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

function historyLimit(value) {
  if (value === undefined || value === null || value === "") return 10;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw invalidRequest(`History limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}.`);
  }
  return limit;
}

export function serviceHistoryFreshness(syncState, now = new Date()) {
  const attemptedAt = syncState.lastAttemptedAt ? new Date(syncState.lastAttemptedAt) : null;
  const succeededAt = syncState.lastSucceededAt ? new Date(syncState.lastSucceededAt) : null;
  const errorAt = syncState.lastErrorAt ? new Date(syncState.lastErrorAt) : null;
  const failedAfterSuccess = errorAt && (!succeededAt || errorAt > succeededAt);
  const unfinishedAfterSuccess = attemptedAt && (!succeededAt || attemptedAt > succeededAt) && !errorAt;
  const expiredSuccess = succeededAt && now.valueOf() - succeededAt.valueOf() > HISTORY_FRESHNESS_MAX_AGE_MS;
  let state = "never_synced";
  if (failedAfterSuccess && succeededAt) state = "stale";
  else if (failedAfterSuccess || unfinishedAfterSuccess) state = succeededAt ? "stale" : "unavailable";
  else if (expiredSuccess) state = "stale";
  else if (succeededAt) state = "current";
  return {
    state,
    checkedAt: now.toISOString(),
    lastAttemptedAt: attemptedAt?.toISOString() || null,
    lastSucceededAt: succeededAt?.toISOString() || null,
    lastErrorAt: errorAt?.toISOString() || null,
    errorCode: failedAfterSuccess
      ? syncState.lastErrorCode || "SERVICE_HISTORY_SYNC_FAILED"
      : expiredSuccess ? "SERVICE_HISTORY_SYNC_STALE" : "",
    warning: failedAfterSuccess
      ? syncState.lastErrorMessage || "Service history could not be synchronized."
      : expiredSuccess ? "The last successful Odoo history sync is more than 24 hours old." : "",
  };
}

function publicUnit(workorder) {
  const asset = workorder.asset || {};
  return {
    assetId: workorder.assetId || null,
    unitNo: asset.unitNo || workorder.formData?.unitNo || "",
    name: asset.name || "",
    make: asset.make || "",
    model: asset.model || workorder.formData?.model || "",
    year: asset.year || null,
    mileage: asset.lastOdometerMiles ?? null,
  };
}

function responseState({ assetId, freshness, historyCount }) {
  if (!assetId) return "unlinked";
  if (freshness.state === "unavailable") return "unavailable";
  if (freshness.state === "stale") return "stale";
  if (historyCount === 0 && freshness.state === "current") return "empty";
  if (historyCount === 0 && freshness.state === "never_synced") return "never_synced";
  return "ready";
}

export async function readUnitServiceHistory(context, workorderId, input = {}, dependencies = {}) {
  const loadWorkorder = dependencies.loadWorkorder || getOperationalWorkorderById;
  const candidate = await loadWorkorder(workorderId);
  if (!candidate || !context.companyIds?.has(candidate.companyId)) throw resourceNotFound("Workorder");
  const effectiveRole = context.companyRoles?.get(candidate.companyId);
  if (!effectiveRole) throw resourceNotFound("Workorder");
  if (effectiveRole !== "admin" && candidate.locationId && !context.locationIds?.has(candidate.locationId)) {
    throw resourceNotFound("Workorder");
  }
  const effectiveContext = { ...context, actor: { ...context.actor, role: effectiveRole } };
  const requireAccess = dependencies.requireAccess || requireWorkorderAccess;
  const scopedWorkorder = await requireAccess(effectiveContext, workorderId, {
    getWorkorder: async () => candidate,
  });
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  const authorization = await authorize(effectiveContext, workorderId, {
    moduleKey: "unit",
    capability: "read",
    resourceAccess: {},
  }, { requireAccess: async () => scopedWorkorder });
  const workorder = authorization.workorder;
  const companyId = workorder.companyId;
  const assetId = workorder.assetId || null;
  const limit = historyLimit(input.limit);
  const readSyncState = dependencies.readSyncState || readServiceHistorySyncState;
  const syncStatePromise = readSyncState(companyId, "odoo");
  const historyPromise = assetId
    ? (dependencies.listHistory || listUnitServiceHistory)(companyId, assetId, workorder.id, {
      limit,
      cursor: input.cursor || null,
    })
    : Promise.resolve({
      items: [], historyCount: 0, lastCompletedServiceAt: null,
      latestRecordedServiceAt: null, nextCursor: null,
    });
  const [syncState, history] = await Promise.all([syncStatePromise, historyPromise]);
  const freshness = serviceHistoryFreshness(syncState, dependencies.now || new Date());
  return {
    state: responseState({ assetId, freshness, historyCount: history.historyCount }),
    unit: publicUnit(workorder),
    summary: {
      historyCount: history.historyCount,
      returnedCount: history.items.length,
      lastCompletedServiceAt: history.lastCompletedServiceAt,
      latestRecordedServiceAt: history.latestRecordedServiceAt,
    },
    freshness,
    items: history.items,
    nextCursor: history.nextCursor,
  };
}
