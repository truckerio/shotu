import test from "node:test";
import assert from "node:assert/strict";
import { handleInspectionsApi } from "./inspections.routes.js";

function harness(body={}){const sent=[];return{sent,helpers:{requestContext:{actor:{id:"u"}},readBody:async()=>body,sendJson:(_res,status,payload)=>sent.push({status,payload})}};}
test("route validates and delegates weekly inspection creation",async()=>{const input={companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",mechanicUserIds:[]};const h=harness(input);let received;assert.equal(await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),h.helpers,{request:async(_context,value)=>(received=value,{id:"i"})}),true);assert.equal(h.sent[0].status,201);assert.equal(received.officeInstructions,"");});
test("route rejects any inspection type choice including annual",async()=>{const h=harness({companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",inspectionType:"annual"});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),h.helpers,{request:async()=>assert.fail()}),/Unrecognized key|unrecognized/i);});
test("route parses bounded cursor list without loading detail",async()=>{const h=harness();let value;await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections?status=completed&limit=20&search=T12"),h.helpers,{list:async(_context,input)=>(value=input,{items:[],nextCursor:null})});assert.equal(value.limit,20);assert.equal(value.status,"completed");assert.equal(h.sent[0].status,200);});
test("response route requires expected version and issue details",async()=>{const h=harness({expectedVersion:2,responses:[{itemKey:"brakes",response:"issue"}]});await assert.rejects(handleInspectionsApi({method:"PATCH"},{},new URL("http://x/api/inspections/i/responses"),h.helpers,{responses:async()=>assert.fail()}),/severity|finding|Issue/i);});
test("assignment, eligible workorders, link, and archive routes use narrow validated contracts", async () => {
  const h = harness({ expectedVersion:2, mechanicUserIds:["33333333-3333-4333-8333-333333333333"] });
  let assignment;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/assignments"),h.helpers,{assign:async(_context,id,input) => (assignment={id,input},{id})});
  assert.equal(assignment.id,"i"); assert.equal(assignment.input.expectedVersion,2);
  const lookup=harness(); await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/i/workorders?search=WO&limit=3"),lookup.helpers,{eligibleWorkorders:async(_context,id,input) => ({items:[{id,input}]})});
  assert.deepEqual(lookup.sent[0].payload.items[0].input,{search:"WO",limit:3});
  const link=harness({expectedVersion:3,workorderId:"44444444-4444-4444-8444-444444444444",idempotencyKey:"inspection-link-001"}); let linked;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/findings/f/workorder-links"),link.helpers,{link:async(_context,id,findingId,input) => (linked={id,findingId,input},{id})});
  assert.equal(linked.findingId,"f"); assert.equal(linked.input.workorderId,"44444444-4444-4444-8444-444444444444");
  const archive=harness({idempotencyKey:"inspection-print-001"}); await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/print-archives"),archive.helpers,{createArchive:async()=>({archive:{id:"a"}})});
  assert.equal(archive.sent[0].status,201);
});

test("revision and atomic finding-workorder routes require versioned idempotent payloads", async () => {
  const revision=harness({expectedVersion:3,reason:"Correct a recorded finding",mechanicUserIds:[],idempotencyKey:"inspection-revision-001"}); let revised;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/revisions"),revision.helpers,{revise:async(_context,id,input)=>(revised={id,input},{id:"successor"})});
  assert.equal(revised.id,"i"); assert.equal(revised.input.reason,"Correct a recorded finding"); assert.equal(revision.sent[0].status,201);
  const create=harness({expectedVersion:3,findingIds:["44444444-4444-4444-8444-444444444444"],idempotencyKey:"inspection-create-001"}); let received;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/workorders"),create.helpers,{createWorkorder:async(_context,id,input)=>(received={id,input},{workorderId:"w"})});
  assert.equal(received.id,"i"); assert.deepEqual(received.input.findingIds,["44444444-4444-4444-8444-444444444444"]); assert.equal(create.sent[0].status,201);
});
