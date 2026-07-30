import { ZodError } from "zod";
import { proofreadingRequestSchema } from "../modules/proofreading/proofreading.schemas.js";
import { checkNarrativeText } from "../modules/proofreading/proofreading.service.js";

export async function handleProofreadingApi(req, res, url, helpers) {
  if (url.pathname !== "/api/proofreading/check") return false;
  if (req.method !== "POST") return false;

  try {
    const input = proofreadingRequestSchema.parse(await helpers.readBody(req));
    helpers.sendJson(res, 200, await checkNarrativeText(input));
  } catch (error) {
    if (error instanceof ZodError) {
      helpers.sendJson(res, 400, { error: "Enter at least three characters to check spelling." });
    } else {
      helpers.sendJson(res, 503, { error: "Proofreading is temporarily unavailable." });
    }
  }
  return true;
}
