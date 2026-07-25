import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

export const authNodeHandler = toNodeHandler(auth);

export function isAuthRoute(pathname) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export async function handleAuthApi(req, res, url) {
  if (!isAuthRoute(url.pathname)) return false;
  await authNodeHandler(req, res);
  return true;
}

