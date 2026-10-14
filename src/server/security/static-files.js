import { readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const BUILD_ASSET_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

const EXPLICIT_PUBLIC_ASSETS = Object.freeze({
  "/samsara-logo.png": "image/png",
  "/workorder-template.jpg": "image/jpeg",
});

function sendText(res, statusCode, body, headers = {}) {
  const bytes = Buffer.from(body);
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": bytes.length,
    ...headers,
  });
  res.end(bytes);
}

function isContained(root, candidate) {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

async function readContainedFile(root, relativePath) {
  try {
    const realRoot = await realpath(root);
    const realFile = await realpath(resolve(realRoot, relativePath));
    if (!isContained(realRoot, realFile)) return null;
    return await readFile(realFile);
  } catch {
    return null;
  }
}

function decodedPathname(req) {
  try {
    const rawTarget = String(req.url || "");
    const rawPathname = rawTarget.split("?", 1)[0];
    if (!rawPathname.startsWith("/")) return null;
    const decoded = decodeURIComponent(rawPathname);
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function buildAsset(pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return { relativePath: "index.html", contentType: "text/html; charset=utf-8" };
  }
  if (!pathname.startsWith("/assets/")) return null;
  const relativePath = pathname.slice(1);
  const contentType = BUILD_ASSET_TYPES[extname(relativePath).toLowerCase()];
  if (!contentType || relativePath.split("/").some((part) => !part || part.startsWith("."))) return null;
  return { relativePath, contentType };
}

function cacheControl(pathname) {
  return pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function sendFile(req, res, body, pathname, contentType) {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": cacheControl(pathname),
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

export async function serveStaticFiles(req, res, {
  frontendDistDir,
  frontendPublicDir,
} = {}) {
  if (!new Set(["GET", "HEAD"]).has(req.method)) {
    sendText(res, 405, "Method not allowed", { allow: "GET, HEAD" });
    return;
  }

  const pathname = decodedPathname(req);
  if (!pathname || pathname.includes("//") || pathname.split("/").includes("..")) {
    sendText(res, 404, "Not found");
    return;
  }

  const asset = buildAsset(pathname);
  if (asset) {
    const body = await readContainedFile(frontendDistDir, asset.relativePath);
    if (body) {
      sendFile(req, res, body, pathname, asset.contentType);
      return;
    }
  }

  const explicitType = EXPLICIT_PUBLIC_ASSETS[pathname];
  if (explicitType) {
    const relativePath = pathname.slice(1);
    const body = await readContainedFile(frontendDistDir, relativePath)
      || await readContainedFile(frontendPublicDir, relativePath);
    if (body) {
      sendFile(req, res, body, pathname, explicitType);
      return;
    }
  }

  sendText(res, 404, "Not found");
}

export { BUILD_ASSET_TYPES, EXPLICIT_PUBLIC_ASSETS };
