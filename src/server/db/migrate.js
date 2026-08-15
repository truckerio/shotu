import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closePool, getPool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
let migratePromise;

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

const LEGACY_MIGRATION_CHECKSUMS = new Map([
  [
    "019_not_null_constraint_name_cleanup.sql",
    new Set([
      "69b4787e8422993a3b83efba357c06163f1dc1d76c7919116650371871452d5b",
    ]),
  ],
  [
    "041_one_active_workorder_per_asset.sql",
    new Set([
      "7cf9bbddfe1e52e0bfeae23c9e900e1f17293ed4e2a07d71885a2df77d32e77e",
    ]),
  ],
]);

function migrationChecksumMatches(name, appliedChecksum, currentChecksum) {
  if (appliedChecksum === currentChecksum) return true;
  return LEGACY_MIGRATION_CHECKSUMS.get(name)?.has(appliedChecksum) || false;
}

async function orderedMigrations() {
  const migrationsDir = join(__dirname, "migrations");
  const names = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    return { name, sql, checksum: checksum(sql) };
  }));
}

async function runMigrations() {
  const migrations = await orderedMigrations();
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('workorder-generator:migrate'))");
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const migration of migrations) {
      const applied = await client.query(
        "select checksum from schema_migrations where name = $1 limit 1",
        [migration.name],
      );
      if (applied.rows[0]) {
        if (!migrationChecksumMatches(migration.name, applied.rows[0].checksum, migration.checksum)) {
          throw new Error(`Applied migration ${migration.name} has been modified.`);
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        "insert into schema_migrations (name, checksum) values ($1, $2)",
        [migration.name, migration.checksum],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  if (!migratePromise) {
    migratePromise = runMigrations().catch((error) => {
      migratePromise = undefined;
      throw error;
    });
  }
  await migratePromise;
}

if (isCli) {
  migrate()
    .then(async () => {
      await closePool();
      console.log("Database schema is up to date.");
    })
    .catch(async (error) => {
      await closePool().catch(() => {});
      console.error(error.message);
      process.exit(1);
    });
}
