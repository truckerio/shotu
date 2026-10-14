import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cycle counts route operators to stock by location or count-sheet import",async()=>{
 const source=await readFile(new URL("./InventoryStockTasks.jsx",import.meta.url),"utf8");
 assert.match(source,/if\(kind==='count'&&!initialTaskId\)return/);
 assert.match(source,/Physical counts/);
 assert.match(source,/Open stock by location/);
 assert.match(source,/Import starting inventory/);
 assert.match(source,/onOpenLocations\?\.\(locationId\)/);
 assert.match(source,/onImportCount\?\.\(\)/);
});

test("transfer receipt, damaged arrivals, and return require a fetched physical destination",async()=>{
 const source=await readFile(new URL("./InventoryStockTasks.jsx",import.meta.url),"utf8");
 assert.match(source,/StoragePositionPicker/);
 assert.match(source,/\/locations\/\$\{encodeURIComponent\(locationId\)\}\/positions/);
 assert.match(source,/receive_transfer_return/);
 assert.match(source,/TransferHoldPositionPicker/);
 assert.match(source,/report_transfer_discrepancy/);
 assert.match(source,/targetPositionId/);
 assert.match(source,/purpose=\{exactDestinationPurpose\}/);
 assert.match(source,/setTargetPositionId\(''\)/);
});

test("transfer workflow keeps dispatch and exceptions progressive",async()=>{
 const source=await readFile(new URL("./InventoryStockTasks.jsx",import.meta.url),"utf8");
 assert.match(source,/Pick from source bins/);
 assert.match(source,/Confirm dispatch/);
 assert.match(source,/Hide expected serials from the receiver/);
 assert.match(source,/Report a discrepancy or return/);
 assert.match(source,/resolve_transfer_discrepancy/);
 assert.match(source,/Resolution note/);
 assert.match(source,/exception\.remaining_quantity\?\?exception\.quantity/);
 assert.match(source,/!reason\.trim\(\)\|\|!holder\.trim\(\)/);
 assert.match(source,/transferStatus\(t\)\.label/);
});

test("stock tasks use bounded checkpoint loading without coupling an open task to visible pages",async()=>{
 const source=await readFile(new URL("./InventoryStockTasks.jsx",import.meta.url),"utf8");
 assert.match(source,/useCheckpointPages/);
 assert.match(source,/CheckpointCollection/);
 assert.match(source,/total:result\.total,pageCount:result\.pageCount/);
 assert.match(source,/entries\.map\(\(\{item:t,key:rowKey,rowProps\}\)=>/);
 assert.match(source,/<OperationalDataRow \{\.\.\.rowProps\}/);
 assert.match(source,/const \[error,setError\].*\[selected,setSelected\]/);
 assert.doesNotMatch(source,/>Previous<|>Next</);
});
