import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
import { PRODUCT_MODULE_ROLES } from "../../../../shared/product-modules.js";

export const productModuleRuleSchema = z.object({
  companyId: z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID"),
  locationId: z.string().uuid().nullable().optional(),
  subjectType: z.enum(["role", "user"]),
  subjectId: z.string().min(1).max(100),
  moduleKey: z.enum(["workorders", "inspections"]),
  mode: z.enum(["inherit", "off", "read", "full"]),
  expectedVersion: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.subjectType === "role" && !PRODUCT_MODULE_ROLES.includes(value.subjectId)) {
    context.addIssue({ code: "custom", path: ["subjectId"], message: "Select a valid role." });
  }
  if (value.subjectType === "user" && !z.string().uuid().safeParse(value.subjectId).success) {
    context.addIssue({ code: "custom", path: ["subjectId"], message: "Select a valid user." });
  }
});
