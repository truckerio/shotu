import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

export const authNodeHandler = toNodeHandler(auth);

export function isAuthRoute(pathname) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export async function handleAuthApi(req, res, url) {
  if (!isAuthRoute(url.pathname)) return false;
  if (url.pathname.startsWith("/api/auth/admin/")) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found." }));
    return true;
  }
  await authNodeHandler(req, res);
  return true;
}
