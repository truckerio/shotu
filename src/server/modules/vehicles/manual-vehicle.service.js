import { z } from "zod";
import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { createManualVehicle, findVehicleIdentityDuplicates } from "../../db/repositories/assets.repo.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";

const uuid = z.string().uuid();
const text = z.string().trim().max(120);

export const createManualVehicleSchema = z.object({
  companyId: uuid,
  locationId: uuid,
  unitType: z.enum(["Truck", "Trailer"]),
  unitNo: text.min(1, "Unit number is required."),
  vin: text.optional().default(""),
  licensePlate: text.optional().default(""),
  name: text.optional().default(""),
  confirmDuplicate: z.boolean().optional().default(false),
}).strict();

export function normalizedVehicleIdentity(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function duplicateConflict() {
  const error = new Error("A local unit with the same unit number, VIN, or plate may already exist. Select it or confirm creating a duplicate.");
  error.statusCode = 409;
  error.code = "MANUAL_VEHICLE_DUPLICATE_CONFIRMATION_REQUIRED";
  return error;
}

export async function createLocalVehicle(context, rawInput, dependencies = {}) {
  const input = createManualVehicleSchema.parse(rawInput);
  const actor = requireActor(context);
  const role = context.companyRoles?.get(input.companyId) || actor.role;
  if (!context.companyIds?.has(input.companyId)) throw resourceNotFound("Location");
  if (!["office", "admin"].includes(role)) throw permissionDenied();
  if (role !== "admin" && !context.locationIds?.has(input.locationId)) throw resourceNotFound("Location");

  const readLocation = dependencies.readLocation || getLocationById;
  const location = await readLocation(input.locationId, [input.companyId]);
  if (!location || (location.company_id || location.companyId) !== input.companyId || location.active === false) throw resourceNotFound("Location");

  const identity = {
    unitNo: normalizedVehicleIdentity(input.unitNo),
    vin: normalizedVehicleIdentity(input.vin),
    licensePlate: normalizedVehicleIdentity(input.licensePlate),
  };
  const findDuplicates = dependencies.findDuplicates || findVehicleIdentityDuplicates;
  const duplicates = await findDuplicates({ companyId: input.companyId, ...identity });
  if (duplicates.length && !input.confirmDuplicate) throw duplicateConflict();

  const create = dependencies.create || createManualVehicle;
  const vehicle = await create({ ...input, unitNo: input.unitNo, vin: input.vin, licensePlate: input.licensePlate });
  if (!vehicle) throw new Error("Local unit could not be created.");
  return vehicle;
}
