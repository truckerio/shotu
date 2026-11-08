import * as service from "../modules/customer-repair-portal/customer-repair-portal.service.js";
export async function handleCustomerRepairPortalApi(
  req,
  res,
  url,
  helpers,
  deps = {},
) {
  const { readBody, requestContext, sendJson } = helpers;
  const call = (name, ...args) => (deps[name] || service[name])(...args);
  const token = req.headers?.["x-customer-repair-grant"] || "";
  const staff =
    /^\/api\/customer-repair\/workorders\/([^/]+)\/(links|chat)$/.exec(
      url.pathname,
    );
  if (staff) {
    const id = decodeURIComponent(staff[1]);
    if (staff[2] === "links" && req.method === "POST") {
      sendJson(
        res,
        201,
        await call(
          "createCustomerRepairLink",
          requestContext,
          id,
          await readBody(req),
        ),
      );
      return true;
    }
    if (staff[2] === "chat" && ["GET", "POST"].includes(req.method)) {
      sendJson(
        res,
        req.method === "GET" ? 200 : 201,
        await call(
          req.method === "GET" ? "readStaffRepairChat" : "sendStaffRepairChat",
          requestContext,
          id,
          req.method === "GET"
            ? Object.fromEntries(url.searchParams)
            : await readBody(req),
        ),
      );
      return true;
    }
  }
  const grant = /^\/api\/customer-repair\/links\/([^/]+)\/(revoke|email)$/.exec(
    url.pathname,
  );
  if (grant && req.method === "POST") {
    sendJson(
      res,
      200,
      await call(
        grant[2] === "revoke"
          ? "revokeCustomerRepairLink"
          : "emailCustomerRepairLink",
        requestContext,
        decodeURIComponent(grant[1]),
        await readBody(req),
      ),
    );
    return true;
  }
  if (url.pathname === "/api/customer-repair/portal" && req.method === "GET") {
    sendJson(res, 200, await call("readCustomerRepairPortal", token));
    return true;
  }
  if (
    url.pathname === "/api/customer-repair/portal/responses" &&
    req.method === "POST"
  ) {
    sendJson(
      res,
      200,
      await call("respondToCustomerRepairEstimate", token, await readBody(req)),
    );
    return true;
  }
  if (
    url.pathname === "/api/customer-repair/portal/chat" &&
    ["GET", "POST"].includes(req.method)
  ) {
    sendJson(
      res,
      req.method === "GET" ? 200 : 201,
      await call(
        req.method === "GET"
          ? "readCustomerRepairChat"
          : "sendCustomerRepairChat",
        token,
        ...(req.method === "GET" ? [] : [await readBody(req)]),
      ),
    );
    return true;
  }
  return false;
}
