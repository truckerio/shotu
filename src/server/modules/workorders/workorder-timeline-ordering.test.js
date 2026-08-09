import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL(
  "../../db/repositories/operational-workorders.repo.js",
  import.meta.url,
);

test("shared workorder timeline uses deterministic chronological ordering", async () => {
  const repository = await readFile(repositoryUrl, "utf8");

  assert.match(
    repository,
    /export async function getWorkorderTimeline[\s\S]*order by created_at asc, id asc/,
  );
});
