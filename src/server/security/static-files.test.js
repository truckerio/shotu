import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { serveStaticFiles } from "./static-files.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "workorder-static-"));
  const dist = join(root, "frontend", "dist");
  const publicDir = join(root, "frontend", "public");
  await mkdir(join(dist, "assets"), { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(dist, "index.html"), "<!doctype html><title>Workorders</title>");
  await writeFile(join(dist, "assets", "app-123.js"), "export const ready = true;");
  await writeFile(join(dist, "assets", "app-123.js.map"), "private source map");
  await writeFile(join(publicDir, "samsara-logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(publicDir, "workorder-template.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(join(root, ".env"), "SECRET=do-not-serve");
  await writeFile(join(root, "server.js"), "secret source");
  await writeFile(join(root, "outside.js"), "outside");
  await symlink(join(root, "outside.js"), join(dist, "assets", "outside.js"));

  const server = createServer((req, res) => serveStaticFiles(req, res, {
    frontendDistDir: dist,
    frontendPublicDir: publicDir,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { port };
}

function request(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves the built index, allowlisted hashed assets, and explicit public images", async (t) => {
  const { port } = await fixture(t);
  const index = await request(port, "/");
  assert.equal(index.statusCode, 200);
  assert.match(index.body.toString("utf8"), /Workorders/);
  assert.equal(index.headers["cache-control"], "no-cache");

  const script = await request(port, "/assets/app-123.js");
  assert.equal(script.statusCode, 200);
  assert.equal(script.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(script.headers["cache-control"], "public, max-age=31536000, immutable");

  assert.equal((await request(port, "/samsara-logo.png")).statusCode, 200);
  assert.equal((await request(port, "/workorder-template.jpg")).statusCode, 200);
});

test("HEAD returns metadata without a body and non-read methods fail closed", async (t) => {
  const { port } = await fixture(t);
  const head = await request(port, "/assets/app-123.js", "HEAD");
  assert.equal(head.statusCode, 200);
  assert.equal(Number(head.headers["content-length"]), "export const ready = true;".length);
  assert.equal(head.body.length, 0);

  const post = await request(port, "/assets/app-123.js", "POST");
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
});

test("does not expose source, secrets, private storage, source maps, or unknown files", async (t) => {
  const { port } = await fixture(t);
  for (const path of [
    "/.env",
    "/server.js",
    "/package.json",
    "/.local-secrets/invoice-document.key",
    "/data/serial-ledger.json",
    "/uploaded-workorders/customer/order.pdf",
    "/printed-workorders/order.pdf",
    "/share-packages/export/manifest.json",
    "/assets/app-123.js.map",
    "/unknown.txt",
  ]) {
    assert.equal((await request(port, path)).statusCode, 404, path);
  }
});

test("rejects encoded traversal, sibling-prefix traversal, malformed escapes, and escaping symlinks", async (t) => {
  const { port } = await fixture(t);
  for (const path of [
    "/%2e%2e%2fserver.js",
    "/assets/%2e%2e%2f%2e%2e%2f.env",
    "/assets/%2e%2e%2f%2e%2e%2fdist-evil%2fapp.js",
    "/assets/%E0%A4%A",
    "/assets/outside.js",
  ]) {
    assert.equal((await request(port, path)).statusCode, 404, path);
  }
});
