import { query } from "../../db/pool.js";
import { setWorkorderAttention } from "../../db/repositories/workorder-attention.repo.js";
import {
  createOdooWorkorderDraft,
  mapOdooWorkorderPart,
  OdooOutboundError,
  odooWorkorderReadiness,
  prepareOdooWorkorder,
} from "../../integrations/odoo/odoo.outbound.service.js";
import { authorizeWorkorderModule } from "./workorder-module-access.service.js";
import {
  ODOO_ELIGIBLE_LIFECYCLES,
  lifecycleIn,
} from "./workorder-lifecycle-policy.js";

const ODOO_MODULE_KEY = "odoo";

function notEligible() {
  return new OdooOutboundError(
    "WORKORDER_NOT_ELIGIBLE",
    "Office approval is required before Odoo processing.",
    409,
  );
}

export async function authorizeWorkorderOdooModule(
  context,
  workorderId,
  { write = false, action = null } = {},
  dependencies = {},
) {
  const authorizeModule = dependencies.authorizeModule || authorizeWorkorderModule;
  const authorization = await authorizeModule(context, workorderId, {
    moduleKey: ODOO_MODULE_KEY,
    capability: write ? "write" : "read",
    action,
  }, {
    requireAccess: dependencies.requireAccess,
    getEffectivePolicy: dependencies.getEffectivePolicy || (dependencies.getPolicy
      ? async () => ({ companyPolicy: null, locationPolicy: await dependencies.getPolicy() })
      : undefined),
  });
  const { workorder } = authorization;

  if (!lifecycleIn(workorder.status, ODOO_ELIGIBLE_LIFECYCLES)) throw notEligible();

  return {
    access: authorization.access,
    source: authorization.source,
    companyId: workorder.companyId,
    workorder,
    workorderId,
  };
}

export async function workorderOdooReadiness(context, workorderId, dependencies = {}) {
  const authorization = await authorizeWorkorderOdooModule(
    context,
    workorderId,
    { write: false },
    dependencies,
  );
  const readiness = dependencies.readiness || odooWorkorderReadiness;
  return readiness({
    companyId: authorization.companyId,
    workorderId: authorization.workorderId,
  });
}

export async function prepareWorkorderOdooModule(context, workorderId, input, dependencies = {}) {
  const authorization = await authorizeWorkorderOdooModule(
    context,
    workorderId,
    { write: true, action: "prepare" },
    dependencies,
  );
  const prepare = dependencies.prepare || prepareOdooWorkorder;
  return prepare({
    companyId: authorization.companyId,
    workorderId: authorization.workorderId,
    userId: context.actor.id,
    input: {
      laborHours: input.laborHours,
      customerExternalId: input.customerExternalId ?? null,
    },
  });
}

export async function createWorkorderOdooDraft(context, workorderId, input, dependencies = {}) {
  const authorization = await authorizeWorkorderOdooModule(
    context,
    workorderId,
    { write: true, action: "createDraft" },
    dependencies,
  );
  const createDraft = dependencies.createDraft || createOdooWorkorderDraft;
  return createDraft({
    companyId: authorization.companyId,
    workorderId: authorization.workorderId,
    userId: context.actor.id,
    requestId: input.requestId || null,
    input: {
      expectedUpdatedAt: input.expectedUpdatedAt,
    },
  });
}

export async function mapWorkorderOdooPart(context, workorderId, input, dependencies = {}) {
  const authorization = await authorizeWorkorderOdooModule(
    context,
    workorderId,
    { write: true, action: "mapPart" },
    dependencies,
  );
  const mapPart = dependencies.mapPart || mapOdooWorkorderPart;
  return mapPart({
    companyId: authorization.companyId,
    workorderId: authorization.workorderId,
    userId: context.actor.id,
    requestId: input.requestId || null,
    input: {
      lineIndex: input.lineIndex,
      productExternalId: input.productExternalId,
    },
  });
}

export async function markWorkorderOdooMissingInfo(context, workorderId, input, dependencies = {}) {
  await authorizeWorkorderOdooModule(
    context,
    workorderId,
    { write: true, action: "markMissingInfo" },
    dependencies,
  );
  const runQuery = dependencies.query || query;
  const updateAttention = dependencies.setAttention || setWorkorderAttention;
  const result = await runQuery(
    `insert into odoo_entry_status (workorder_id, status, note, updated_at)
     values ($1, 'missing_info', $2, now())
     on conflict (workorder_id) do update
     set status = 'missing_info', note = excluded.note, updated_at = now()
     returning *`,
    [workorderId, input.note],
  );
  await updateAttention({
    workorderId,
    reason: "missing_info",
    active: true,
    actorUserId: context.actor.id,
    details: { note: input.note, source: "workorder_odoo_module" },
  });
  return result.rows[0];
}
