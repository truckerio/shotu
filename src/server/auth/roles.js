import { z } from "zod";

export const USER_ROLES = Object.freeze([
  "mechanic",
  "office",
  "surveillance",
  "admin",
]);

export const userRoleSchema = z.enum(USER_ROLES);
