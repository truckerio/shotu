import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createInventoryPosition, moveInventoryPosition, readPositionStock, startPositionCount, recordPositionCountFoundPart, recordPositionCountIdentity, applyPositionCount,
} from "./inventory-positions.service.js";

const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),partId=randomUUID(),positionId=randomUUID();
const office={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
const admin={...office,actor:{id:actorId,role:"admin"}};

test("creates a hierarchy node with independent kind and usage",async()=>{
  let captured;
  const result=await createInventoryPosition(locationId,{parentId:null,code:"A-01",name:"Aisle 1",kind:"aisle",usage:null,canStore:false,idempotencyKey:"create-a-01"},office,
    {insertPosition:async(input)=>(captured=input,{kind:"created",position:{id:positionId,code:input.code}})});
  assert.equal(captured.locationId,locationId);assert.equal(captured.canStore,false);assert.equal(result.position.code,"A-01");assert.equal(result.replayed,false);
});

test("rejects a non-storage grouping node marked pickable",async()=>{
  await assert.rejects(()=>createInventoryPosition(locationId,{code:"BAD",name:"Bad",kind:"area",usage:null,canStore:false,isPickable:true,idempotencyKey:"create-bad"},office,
    {insertPosition:async()=>assert.fail("repository should not run")}),/Only usable stock positions can be pickable/);
});

test("rejects a sublocation type that does not fit its parent",async()=>{
  await assert.rejects(()=>createInventoryPosition(locationId,{parentId:positionId,code:"BAD-CHILD",name:"Bad child",kind:"warehouse",usage:null,canStore:false,idempotencyKey:"create-bad-child"},office,
    {insertPosition:async()=>({kind:"invalid_parent_kind"})}),
  (error)=>error.code==="INVENTORY_POSITION_HIERARCHY_INVALID"&&error.statusCode===422);
});

test("move contract keeps aggregate and exact payloads exclusive",async()=>{
  const destination=randomUUID();let aggregate;
  await moveInventoryPosition(partId,locationId,{fromPositionId:positionId,toPositionId:destination,quantity:2,expectedSourceVersion:1,idempotencyKey:"move-aggregate",reason:"Put away"},office,
    {moveStock:async(input)=>(aggregate=input.move,{kind:"moved",operation:{id:randomUUID(),type:"move",movementCount:1}})});
  assert.equal(aggregate.quantity,2);assert.equal("unitIds" in aggregate,false);
  await assert.rejects(()=>moveInventoryPosition(partId,locationId,{fromPositionId:positionId,toPositionId:destination,quantity:1,unitIds:[randomUUID()],expectedSourceVersion:1,idempotencyKey:"move-invalid",reason:"Invalid"},office,
    {moveStock:async()=>assert.fail("repository should not run")}));
  await assert.rejects(()=>moveInventoryPosition(partId,locationId,{fromPositionId:positionId,toPositionId:positionId,quantity:1,expectedSourceVersion:1,idempotencyKey:"move-same-aggregate",reason:"Same place"},office,
    {moveStock:async()=>assert.fail("repository should not run")}),/Destination must differ from source/);
  await assert.rejects(()=>moveInventoryPosition(partId,locationId,{fromPositionId:positionId,toPositionId:positionId,unitIds:[randomUUID()],idempotencyKey:"move-same-exact",reason:"Same place"},office,
    {moveStock:async()=>assert.fail("repository should not run")}),/Destination must differ from source/);
});

test("position stock reads direct or subtree scope through the tenant-scoped repository",async()=>{
  let captured;
  const result=await readPositionStock(locationId,positionId,"subtree",office,{listPositionStock:async(input)=>(captured=input,{scope:input.scope,parts:[{id:partId,directQuantity:2,descendantQuantity:3,subtreeQuantity:5}]})});
  assert.equal(captured.locationId,locationId);assert.equal(captured.positionId,positionId);assert.equal(captured.scope,"subtree");
  assert.deepEqual(result.parts[0],{id:partId,directQuantity:2,descendantQuantity:3,subtreeQuantity:5});
  await readPositionStock(locationId,positionId,null,office,{listPositionStock:async(input)=>({scope:input.scope,parts:[]})});
});

test("position stock rejects invalid scope and hides unavailable positions",async()=>{
  await assert.rejects(()=>readPositionStock(locationId,positionId,"all",office,{listPositionStock:async()=>assert.fail("repository should not run")}));
  await assert.rejects(()=>readPositionStock(randomUUID(),positionId,"direct",office,{listPositionStock:async()=>assert.fail("repository should not run")}),
    (error)=>error.code==="inventory_not_found");
  await assert.rejects(()=>readPositionStock(locationId,positionId,"direct",office,{listPositionStock:async()=>null}),
    (error)=>error.code==="inventory_not_found");
});

test("count apply stays Admin-only and exposes authoritative canApply",async()=>{
  const countId=randomUUID();
  const started=await startPositionCount(locationId,{positionId,idempotencyKey:"count-start"},office,{createCount:async()=>({kind:"created",count:{id:countId,lines:[]}})});
  assert.equal(started.count.canApply,false);
  await assert.rejects(()=>applyPositionCount(countId,{expectedVersion:1,idempotencyKey:"count-apply",reason:"Physical recount"},office,{}),
    (error)=>error.code==="INVENTORY_COUNT_APPLY_FORBIDDEN");
  const applied=await applyPositionCount(countId,{expectedVersion:1,idempotencyKey:"count-apply",reason:"Physical recount"},admin,
    {applyCount:async()=>({kind:"applied"}),getCount:async()=>({id:countId,status:"applied",lines:[]})});
  assert.equal(applied.count.canApply,true);assert.equal(applied.count.status,"applied");
});

test("count apply maps lock contention to a plain retry conflict",async()=>{
  const countId=randomUUID();
  await assert.rejects(()=>applyPositionCount(countId,{expectedVersion:1,idempotencyKey:"count-busy",reason:"Retry count"},admin,
    {applyCount:async()=>({kind:"stock_busy"}),getCount:async()=>assert.fail("busy apply must not load a result")}),
  (error)=>error.code==="INVENTORY_POSITION_STOCK_BUSY"&&error.statusCode===409
    &&error.message==="This count or its stock is being updated. Wait a moment, then apply this count again.");
});

test("serial count identities preserve scanner evidence and map scope-safe errors",async()=>{
  const countId=randomUUID();let captured;
  const result=await recordPositionCountIdentity(countId,{serialNumber:" SERIAL-1 ",inputMode:"scanner",expectedVersion:3,idempotencyKey:"serial-scan-1"},office,{
    saveIdentity:async(input)=>(captured=input,{kind:"observed",alreadyObserved:false}),getCount:async()=>({id:countId,status:"open",version:4,serialGroups:[]})});
  assert.equal(captured.serialNumber,"SERIAL-1");assert.equal(result.count.version,4);assert.equal(result.alreadyObserved,false);
  await assert.rejects(()=>recordPositionCountIdentity(countId,{serialNumber:"OTHER",inputMode:"manual",expectedVersion:4,idempotencyKey:"serial-scan-2"},office,{saveIdentity:async()=>({kind:"serial_wrong_position"})}),
    (error)=>error.code==="INVENTORY_POSITION_SERIAL_WRONG_POSITION"&&error.statusCode===409);
  await assert.rejects(()=>recordPositionCountIdentity(countId,{serialNumber:"HIDDEN",inputMode:"manual",expectedVersion:4,idempotencyKey:"serial-scan-3"},office,{saveIdentity:async()=>({kind:"serial_not_found"})}),
    (error)=>error.code==="INVENTORY_POSITION_SERIAL_NOT_FOUND"&&error.statusCode===404);
  const recount=await recordPositionCountIdentity(countId,{serialNumber:"ARRIVED",inputMode:"scanner",expectedVersion:4,idempotencyKey:"serial-scan-4"},office,{
    saveIdentity:async()=>({kind:"needs_recount"}),getCount:async()=>({id:countId,status:"needs_recount",version:5,serialGroups:[]})});
  assert.equal(recount.count.status,"needs_recount");assert.equal(recount.count.version,5);assert.equal(recount.replayed,false);
});

test("found aggregate stock becomes an expected-zero count line and serialized stock stays outside aggregate corrections",async()=>{
  const countId=randomUUID(),catalogPartId=randomUUID();let captured;
  const result=await recordPositionCountFoundPart(countId,{catalogPartId,expectedPartVersion:7,observedQuantity:3,expectedVersion:2,idempotencyKey:"found-count-line"},office,{
    addFoundPart:async(input)=>(captured=input,{kind:"observed"}),
    getCount:async()=>({id:countId,status:"open",version:3,lines:[{partId:catalogPartId,lineSource:"found",expectedQuantity:0,observedQuantity:3}]})});
  assert.equal(captured.catalogPartId,catalogPartId);assert.equal(captured.expectedPartVersion,7);assert.equal(captured.observedQuantity,3);
  assert.deepEqual(result.count.lines[0],{partId:catalogPartId,lineSource:"found",expectedQuantity:0,observedQuantity:3});
  await assert.rejects(()=>recordPositionCountFoundPart(countId,{catalogPartId,expectedPartVersion:7,observedQuantity:1,expectedVersion:3,idempotencyKey:"found-serialized"},office,
    {addFoundPart:async()=>({kind:"serialized_review_required"}),getCount:async()=>assert.fail("rejected found part must not reload the count")}),
  (error)=>error.code==="INVENTORY_POSITION_SERIAL_COUNT_REVIEW"&&error.statusCode===422);
});
