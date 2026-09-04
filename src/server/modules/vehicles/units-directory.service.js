import { z } from "zod";
import { permissionDenied } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { listUnitsDirectory as listUnitsDirectoryRepository } from "../../db/repositories/units-directory.repo.js";

export const unitsDirectoryQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  type: z.enum(["Truck", "Trailer"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).nullable().optional(),
}).strict();

export async function readUnitsDirectory(context, rawInput, dependencies = {}) {
  const actor = requireActor(context);
  if (!['admin', 'office'].includes(actor.role)) throw permissionDenied();
  const parsed = unitsDirectoryQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    const error = new Error("Invalid Units search. Check the search text, type, or page size.");
    error.statusCode = 400;
    error.code = "INVALID_UNITS_DIRECTORY_QUERY";
    throw error;
  }
  const input = parsed.data;

  return (dependencies.list || listUnitsDirectoryRepository)({
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: actor.role === 'admin',
    q: input.q,
    unitType: input.type || null,
    limit: input.limit,
    cursor: input.cursor || null,
  }, dependencies.repositoryDependencies || {});
}
