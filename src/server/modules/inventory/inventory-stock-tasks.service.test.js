import assert from "node:assert/strict";
import test from "node:test";
import { getStockTask,postStockTask } from "./inventory-stock-tasks.service.js";

const companyId="11111111-1111-4111-8111-111111111111";
const locationId="22222222-2222-4222-8222-222222222222";
const partId="33333333-3333-4333-8333-333333333333";
const context={actor:{id:"44444444-4444-4444-8444-444444444444",role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};

test("stock-task counts route to the canonical position-count workflow before persistence",async()=>{
 await assert.rejects(postStockTask({
  action:"count",locationId,catalogPartId:partId,quantity:4,expectedBalanceRevision:"revision-1",
  holder:"All shelves",serialNumbers:[],reason:"Physical count",idempotencyKey:"55555555-5555-4555-8555-555555555555",
 },context),(error)=>error.code==="INVENTORY_POSITION_COUNT_REQUIRED"&&error.statusCode===409&&/Position count/.test(error.message));
});

test("exact stock-task read preserves requested kind and scoped location",async()=>{
 const taskId="55555555-5555-4555-8555-555555555555";let received;
 const result=await getStockTask(taskId,new URLSearchParams({locationId,kind:"transfer"}),context,{
  resolveInventoryLocationScope:async()=>({companyId,locationId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,effectiveRole:"office"}),
  readStockTask:async(input)=>(received=input,{task:{id:taskId,kind:"transfer"}}),
 });
 assert.equal(received.taskId,taskId);assert.equal(received.locationId,locationId);assert.equal(received.kind,"transfer");
 assert.deepEqual(result,{task:{id:taskId,kind:"transfer"}});
});

test("exact stock-task read accepts only damage or transfer",async()=>{
 await assert.rejects(()=>getStockTask("55555555-5555-4555-8555-555555555555",new URLSearchParams({locationId,kind:"count"}),context),{name:"ZodError"});
});
