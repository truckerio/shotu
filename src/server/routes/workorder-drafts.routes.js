import {
  parseCreateWorkorderDraft,
  parseSubmitWorkorderDraft,
  parseUpdateWorkorderDraft,
  parseWorkorderDraftId,
  parseWorkorderDraftListQuery,
} from "../modules/workorders/workorder-drafts.schemas.js";
import {
  createUserWorkorderDraft,
  discardUserWorkorderDraft,
  getUserWorkorderDraft,
  listUserWorkorderDrafts,
  submitUserWorkorderDraft,
  updateUserWorkorderDraft,
} from "../modules/workorders/workorder-drafts.service.js";

function draftPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/workorder-drafts/([^/]+)${escaped}$`).exec(pathname);
  return match ? parseWorkorderDraftId(decodeURIComponent(match[1])) : null;
}

export async function handleWorkorderDraftsApi(req, res, url, helpers) {
  if (url.pathname !== "/api/workorder-drafts" && !url.pathname.startsWith("/api/workorder-drafts/")) {
    return false;
  }
  const { readBody, requestContext, sendJson } = helpers;

  if (req.method === "GET" && url.pathname === "/api/workorder-drafts") {
    const input = parseWorkorderDraftListQuery(url.searchParams);
    sendJson(res, 200, { drafts: await listUserWorkorderDrafts(requestContext, input) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workorder-drafts") {
    const input = parseCreateWorkorderDraft(await readBody(req));
    sendJson(res, 201, { draft: await createUserWorkorderDraft(requestContext, input) });
    return true;
  }

  const submitId = draftPath(url.pathname, "/submit");
  if (req.method === "POST" && submitId) {
    const input = parseSubmitWorkorderDraft(await readBody(req));
    const result = await submitUserWorkorderDraft(requestContext, submitId, input);
    sendJson(res, 200, { draft: result.draft, workorder: result.workorder });
    return true;
  }

  const id = draftPath(url.pathname);
  if (req.method === "GET" && id) {
    sendJson(res, 200, { draft: await getUserWorkorderDraft(requestContext, id) });
    return true;
  }
  if (req.method === "PATCH" && id) {
    const input = parseUpdateWorkorderDraft(await readBody(req));
    sendJson(res, 200, { draft: await updateUserWorkorderDraft(requestContext, id, input) });
    return true;
  }
  if (req.method === "DELETE" && id) {
    await discardUserWorkorderDraft(requestContext, id);
    sendJson(res, 200, { discarded: true });
    return true;
  }

  return false;
}
