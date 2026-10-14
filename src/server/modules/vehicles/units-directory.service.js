import { z } from "zod";
import { permissionDenied } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { companyRoleScope } from "../../auth/company-role.js";
import {
  listUnitsDirectory as listUnitsDirectoryRepository,
  listUnitsDirectoryFacets as listUnitsDirectoryFacetsRepository,
} from "../../db/repositories/units-directory.repo.js";

const unitTypeSchema = z.enum(["Truck", "Trailer", "Other"]);
const tagFilterSchema = z.string().trim().max(120).default("");

export const unitsDirectoryQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  type: unitTypeSchema.optional(),
  companyTag: tagFilterSchema,
  routeTag: tagFilterSchema,
  repair: z.enum(["all", "under_repair", "available"]).default("all"),
  sort: z.enum(["unit_asc", "unit_desc", "tags_asc", "repair_first"]).default("unit_asc"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).nullable().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
}).strict().superRefine((value, context) => {
  if (value.page && value.cursor) context.addIssue({ code: "custom", message: "Choose a page or cursor, not both." });
});

export async function readUnitsDirectory(context, rawInput, dependencies = {}) {
  requireActor(context);
  const roleScope = companyRoleScope(context, ["admin", "office"]);
  if (!roleScope.companyIds.length) throw permissionDenied();
  const parsed = unitsDirectoryQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    const error = new Error("Invalid Units search. Check the search text, type, or page size.");
    error.statusCode = 400;
    error.code = "INVALID_UNITS_DIRECTORY_QUERY";
    throw error;
  }
  const input = parsed.data;

  return (dependencies.list || listUnitsDirectoryRepository)({
    companyIds: roleScope.companyIds,
    adminCompanyIds: roleScope.adminCompanyIds,
    locationIds: roleScope.locationIds,
    q: input.q,
    unitType: input.type || null,
    companyTag: input.companyTag,
    routeTag: input.routeTag,
    repair: input.repair,
    sort: input.sort,
    limit: input.limit,
    cursor: input.cursor || null,
    ...(input.page ? { page: input.page } : {}),
  }, dependencies.repositoryDependencies || {});
}

export const unitsDirectoryFacetsQuerySchema = z.object({
  type: unitTypeSchema.optional(),
}).strict();

export async function readUnitsDirectoryFacets(context, rawInput, dependencies = {}) {
  requireActor(context);
  const roleScope = companyRoleScope(context, ["admin", "office"]);
  if (!roleScope.companyIds.length) throw permissionDenied();
  const parsed = unitsDirectoryFacetsQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    const error = new Error("Invalid Units filter request.");
    error.statusCode = 400;
    error.code = "INVALID_UNITS_DIRECTORY_FILTERS_QUERY";
    throw error;
  }
  return (dependencies.listFacets || listUnitsDirectoryFacetsRepository)({
    companyIds: roleScope.companyIds,
    adminCompanyIds: roleScope.adminCompanyIds,
    locationIds: roleScope.locationIds,
    unitType: parsed.data.type || null,
  }, dependencies.repositoryDependencies || {});
}
