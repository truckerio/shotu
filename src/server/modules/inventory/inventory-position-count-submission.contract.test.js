import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("submitted count differences are separate Admin review tasks",async()=>{
  const [routes,tasks,schemas]=await Promise.all([
    readFile(new URL("./inventory-positions.routes.js",import.meta.url),"utf8"),
    readFile(new URL("../../db/repositories/inventory-task-queue.repo.js",import.meta.url),"utf8"),
    readFile(new URL("./inventory-task-queue.schemas.js",import.meta.url),"utf8"),
  ]);
  assert.match(routes,/position-counts\\\/\(\[\^\/\]\+\)\\\/submit/);
  assert.match(tasks,/'position_count_review'/);
  assert.match(tasks,/s\.status='ready'/);
  assert.match(tasks,/Inventory is unchanged until an Admin reconciles this count/);
  assert.match(tasks,/'approve_count'.*'admin'/s);
  assert.match(schemas,/'position_count_review'/);
});
