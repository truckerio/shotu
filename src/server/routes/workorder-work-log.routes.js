import { z } from "zod";
import {
  getWorkorderWorkLog,
  patchWorkorderActivityStatus,
  patchWorkorderLabor,
  postWorkorderLabor,
} from "../modules/workorders/workorder-work-log.service.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD.").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Date must be a valid calendar date.");
const createHoursSchema = z.coerce.number().min(1 / 60, "Labor must be at least one minute.").max(24);
const correctionHoursSchema = z.coerce.number().min(0).max(24);

export const activityStatusPatchSchema = z.object({
  status: z.enum(["ready", "active", "on_hold", "waiting_parts", "waiting_office"]),
  expectedVersion: z.coerce.number().int().positive(),
}).strict();

export const laborCreateSchema = z.object({
  id: z.uuid(),
  hours: createHoursSchema,
  date: dateSchema,
  note: z.string().trim().max(2000).default(""),
}).strict().transform((input) => ({ ...input, minutes: Math.round(input.hours * 60) }));

export const laborPatchSchema = z.object({
  hours: correctionHoursSchema,
  date: dateSchema,
  note: z.string().trim().max(2000).default(""),
  expectedVersion: z.coerce.number().int().positive(),
  correctionReason: z.string().trim().min(1).max(1000),
}).strict().transform((input) => ({ ...input, minutes: Math.round(input.hours * 60) }));

function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Invalid work-log request.");
    error.statusCode = 400;
    error.code = "INVALID_REQUEST";
    throw error;
  }
  return result.data;
}

function route(pathname) {
  const labor = /^\/api\/workorders\/([^/]+)\/work-log\/labor(?:\/([^/]+))?$/.exec(pathname);
  if (labor) return {
    workorderId: decodeURIComponent(labor[1]),
    entryId: labor[2] ? decodeURIComponent(labor[2]) : null,
    labor: true,
  };
  const root = /^\/api\/workorders\/([^/]+)\/work-log$/.exec(pathname);
  return root ? { workorderId: decodeURIComponent(root[1]), entryId: null, labor: false } : null;
}

export async function handleWorkorderWorkLogApi(req, res, url, helpers, dependencies = {}) {
  const match = route(url.pathname);
  if (!match) return false;
  const { requestContext, readBody, sendJson } = helpers;
  if (!match.labor && req.method === "GET") {
    sendJson(res, 200, await (dependencies.getWorkLog || getWorkorderWorkLog)(requestContext, match.workorderId));
    return true;
  }
  if (!match.labor && req.method === "PATCH") {
    const input = validated(activityStatusPatchSchema, await readBody(req));
    sendJson(res, 200, await (dependencies.patchStatus || patchWorkorderActivityStatus)(requestContext, match.workorderId, input));
    return true;
  }
  if (match.labor && !match.entryId && req.method === "POST") {
    const input = validated(laborCreateSchema, await readBody(req));
    sendJson(res, 200, await (dependencies.postLabor || postWorkorderLabor)(requestContext, match.workorderId, input));
    return true;
  }
  if (match.labor && match.entryId && req.method === "PATCH") {
    const input = validated(laborPatchSchema, await readBody(req));
    sendJson(res, 200, await (dependencies.patchLabor || patchWorkorderLabor)(requestContext, match.workorderId, match.entryId, input));
    return true;
  }
  return false;
}
