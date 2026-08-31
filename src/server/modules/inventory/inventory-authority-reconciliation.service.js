import { createHash } from "node:crypto";
import { z } from "zod";
import {
  acknowledgeInventoryAuthorityException,
  getInventoryAuthorityException,
  listInventoryAuthorityExceptions,
} from "../../db/repositories/inventory-authority.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import {
  acknowledgeInventoryAuthorityExceptionSchema,
  inventoryAuthorityExceptionListSchema,
} from "./inventory.schemas.js";

function requireAdmin(context) {
  if (context.actor.role !== "admin") {
    throw new InventoryError("Administrator access is required.", {
      code: "INVENTORY_AUTHORITY_ADMIN_REQUIRED", statusCode: 403,
    });
  }
}

function scope(context) {
  return {
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: true,
  };
}

export async function readInventoryAuthorityExceptions(searchParams, context, dependencies = {}) {
  requireAdmin(context);
  const input = inventoryAuthorityExceptionListSchema.parse(Object.fromEntries(searchParams));
  const result = await (dependencies.listAuthorityExceptions || listInventoryAuthorityExceptions)({
    ...scope(context), limit: input.limit, offset: (input.page - 1) * input.limit,
  });
  return { items: result.items, total: result.total, page: input.page, limit: input.limit };
}

export async function readInventoryAuthorityException(exceptionId, context, dependencies = {}) {
  requireAdmin(context);
  exceptionId = z.string().uuid().parse(exceptionId);
  const exception = await (dependencies.getAuthorityException || getInventoryAuthorityException)({
    exceptionId, ...scope(context),
  });
  if (!exception) throw inventoryNotFound();
  return { exception };
}

export async function resolveInventoryAuthorityException(exceptionId, input, context, dependencies = {}) {
  requireAdmin(context);
  exceptionId = z.string().uuid().parse(exceptionId);
  const parsed = acknowledgeInventoryAuthorityExceptionSchema.parse(input);
  const command = {
    exceptionId,
    reason: parsed.reason,
    idempotencyKey: parsed.idempotencyKey,
    actorId: context.actor.id,
    ...scope(context),
  };
  const result = await (dependencies.acknowledgeAuthorityException || acknowledgeInventoryAuthorityException)({
    ...command,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "reservation_blocked") {
    throw new InventoryError("This legacy source still has an active reservation. Release it before acknowledging the exception.", {
      code: "INVENTORY_AUTHORITY_RESERVATION_ACTIVE", statusCode: 409,
    });
  }
  if (result.kind === "idempotency_conflict") {
    throw new InventoryError("That acknowledgement key was already used with different details.", {
      code: "INVENTORY_AUTHORITY_REPLAY_CONFLICT", statusCode: 409,
    });
  }
  return {
    exceptionId: result.exceptionId,
    outcome: result.outcome || "resolved_without_stock_mutation",
    replayed: result.kind === "replay",
  };
}
