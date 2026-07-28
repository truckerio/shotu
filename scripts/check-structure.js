import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const violations = [];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return files.flat();
}

function fail(file, message) {
  violations.push(`${relative(root, file)}: ${message}`);
}

const frontendFiles = (await filesUnder(join(root, "frontend", "src")))
  .filter((file) => [".js", ".jsx"].includes(extname(file)));

for (const file of frontendFiles) {
  const source = await readFile(file, "utf8");
  if (/from\s+["'][^"']*src\/server\//.test(source)) {
    fail(file, "frontend code must use the HTTP API, not import server modules");
  }
  if (/\b(?:UNITS_OF_MEASURE|UOM_DEFINITIONS)\s*=\s*(?:Object\.freeze\()?\s*\[/.test(source)) {
    fail(file, "unit definitions belong in shared/units-of-measure.js");
  }
}

const routeFiles = (await filesUnder(join(root, "src", "server", "routes")))
  .filter((file) => extname(file) === ".js");

for (const file of routeFiles) {
  const source = await readFile(file, "utf8");
  if (/from\s+["'][^"']*db\/pool\.js["']/.test(source)) {
    fail(file, "routes must not access the database pool directly");
  }
  if (file.endsWith("mechanic.routes.js") && source.includes('"/notes"')) {
    fail(file, "mechanic progress must use the optimistic /progress contract");
  }
}

const migrationFiles = (await filesUnder(join(root, "src", "server", "db", "migrations")))
  .filter((file) => extname(file) === ".sql");

for (const file of migrationFiles) {
  const name = file.split("/").at(-1);
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) {
    fail(file, "migration names must use NNN_snake_case.sql");
  }
}

const serverFiles = (await filesUnder(join(root, "src", "server")))
  .filter((file) => extname(file) === ".js");

for (const file of serverFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes("admin.repo.js")) {
    fail(file, "use the repository that owns the table instead of admin.repo.js");
  }
  if (/\b(?:UNITS_OF_MEASURE|UOM_DEFINITIONS)\s*=\s*(?:Object\.freeze\()?\s*\[/.test(source)) {
    fail(file, "unit definitions belong in shared/units-of-measure.js");
  }
}

if (violations.length) {
  console.error(`Structure check failed:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Structure boundaries are valid.");
