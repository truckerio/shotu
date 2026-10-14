import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { clientCheckpointWindow, clientCheckpointBatches } from "./useClientCheckpointPages.js";

test("client windows are bounded and clamp after removals", () => {
  assert.deepEqual(clientCheckpointWindow(1,9,20), {first:5,last:9});
  assert.deepEqual(clientCheckpointWindow(8,12,3), {first:3,last:3});
  assert.deepEqual(clientCheckpointWindow(1,5,0), {first:1,last:1});
});
test("client collections reflect edits/removals rather than cached row objects", () => {
  const items = Array.from({length: 30}, (_,id) => ({id, name:`row ${id}`}));
  const window = clientCheckpointWindow(1,2,3);
  assert.equal(clientCheckpointBatches(items,window,10).flatMap(batch=>batch.items).length,20);
  const revised = items.filter(item=>item.id!==0).map(item=>item.id===1?{...item,name:"edited"}:item);
  const updated = clientCheckpointBatches(revised,window,10).flatMap(batch=>batch.items);
  assert.equal(updated[0].name,"edited");
  assert.equal(updated.some(item=>item.id===0),false);
});
test("client edges bail out without rerender loops for inline-filtered source arrays", () => {
  const source=readFileSync(new URL("./useClientCheckpointPages.js",import.meta.url),"utf8");
  assert.match(source, /\(items \|\| \[\]\)\.slice/);
  assert.match(source, /last === active.last.*return current/);
  assert.match(source, /first === active.first.*return current/);
  assert.doesNotMatch(source, /new Map|React\.Children/);
});
