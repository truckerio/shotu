import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleInventoryPositionsApi } from "./inventory-positions.routes.js";

const companyId=randomUUID(),locationId=randomUUID(),positionId=randomUUID(),actorId=randomUUID();
const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
const harness=(requestContext=context)=>{const sent=[];return {sent,helpers:{requestContext,readBody:async()=>assert.fail("GET must not read a body"),sendJson:(_res,status,value)=>sent.push({status,value})}};};
const path=(location=locationId,position=positionId,query="")=>`http://localhost/api/office/inventory/locations/${location}/positions/${position}/stock${query}`;

test("position stock route forwards subtree scope through the handler boundary",async()=>{
  const {sent,helpers}=harness();let captured;const partId=randomUUID();
  const handled=await handleInventoryPositionsApi({method:"GET"},{},new URL(path(locationId,positionId,"?scope=subtree")),helpers,{listPositionStock:async(input)=>(captured=input,{scope:"subtree",parts:[{id:partId,subtreeQuantity:5}]})});
  assert.equal(handled,true);assert.equal(captured.scope,"subtree");assert.equal(captured.locationId,locationId);assert.equal(captured.positionId,positionId);
  assert.deepEqual(sent,[{status:200,value:{scope:"subtree",parts:[{id:partId,subtreeQuantity:5}]}}]);
});

test("position stock route rejects an invalid scope before calling the repository",async()=>{
  const {helpers}=harness();
  await assert.rejects(()=>handleInventoryPositionsApi({method:"GET"},{},new URL(path(locationId,positionId,"?scope=all")),helpers,{listPositionStock:async()=>assert.fail("repository should not run")}),
    (error)=>error.name==="ZodError");
});

test("position stock route hides an unauthorized location before calling the repository",async()=>{
  const {helpers}=harness();
  await assert.rejects(()=>handleInventoryPositionsApi({method:"GET"},{},new URL(path(randomUUID(),positionId,"?scope=direct")),helpers,{listPositionStock:async()=>assert.fail("repository should not run")}),
    (error)=>error.code==="inventory_not_found"&&error.statusCode===404);
});

test("serialized identity route forwards scanner evidence through the service boundary",async()=>{
  const countId=randomUUID();const body={serialNumber:"SERIAL-1",inputMode:"scanner",expectedVersion:2,idempotencyKey:"route-serial-scan"};let captured;
  const sent=[];const helpers={requestContext:context,readBody:async()=>body,sendJson:(_res,status,value)=>sent.push({status,value})};
  const handled=await handleInventoryPositionsApi({method:"PUT"},{},new URL(`http://localhost/api/office/inventory/position-counts/${countId}/identities`),helpers,{
    saveIdentity:async(input)=>(captured=input,{kind:"observed",alreadyObserved:false}),getCount:async()=>({id:countId,status:"open",version:3,serialGroups:[]})});
  assert.equal(handled,true);assert.equal(captured.serialNumber,"SERIAL-1");assert.equal(captured.actorId,actorId);assert.equal(sent[0].status,200);assert.equal(sent[0].value.count.version,3);
});

test("found-part route preserves catalog version, observed quantity, and count version",async()=>{
  const countId=randomUUID(),catalogPartId=randomUUID();const body={catalogPartId,expectedPartVersion:4,observedQuantity:2,expectedVersion:6,idempotencyKey:"route-found-part"};let captured;
  const sent=[];const helpers={requestContext:context,readBody:async()=>body,sendJson:(_res,status,value)=>sent.push({status,value})};
  const handled=await handleInventoryPositionsApi({method:"POST"},{},new URL(`http://localhost/api/office/inventory/position-counts/${countId}/found-parts`),helpers,{
    addFoundPart:async(input)=>(captured=input,{kind:"observed"}),getCount:async()=>({id:countId,status:"open",version:7,lines:[]})});
  assert.equal(handled,true);assert.equal(captured.catalogPartId,catalogPartId);assert.equal(captured.expectedPartVersion,4);assert.equal(captured.observedQuantity,2);assert.equal(captured.expectedVersion,6);
  assert.equal(sent[0].status,200);assert.equal(sent[0].value.count.version,7);
});

test("count submit route records observations without requiring Admin",async()=>{
  const countId=randomUUID();const body={expectedVersion:3,idempotencyKey:"route-count-submit"};let captured;
  const sent=[];const helpers={requestContext:context,readBody:async()=>body,sendJson:(_res,status,value)=>sent.push({status,value})};
  const handled=await handleInventoryPositionsApi({method:"POST"},{},new URL(`http://localhost/api/office/inventory/position-counts/${countId}/submit`),helpers,{
    submitCount:async(input)=>(captured=input,{kind:"ready"}),getCount:async()=>({id:countId,status:"ready",version:4,lines:[]})});
  assert.equal(handled,true);assert.equal(captured.actorId,actorId);assert.equal(captured.expectedVersion,3);assert.equal(sent[0].status,200);assert.equal(sent[0].value.count.status,"ready");
});
