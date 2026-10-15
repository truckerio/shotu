import assert from "node:assert/strict";
import test from "node:test";
import { getMaintenanceAsset, inspectionMaintenanceRepositoryInternals, listInspectionMaintenance } from "./inspection-maintenance.repo.js";

test("maintenance query is exact company asset and location scoped, excludes closed obligations, and projects durable actual visits", async () => {
  let captured;
  const items=await listInspectionMaintenance({companyId:"c",assetId:"a",locationIds:["l"]},{query:async(sql,values)=>(captured={sql,values},{rows:[{id:"fu",maintenance_obligation_id:"obligation",finding_id:"f",inspection_id:"i",inspection_number:"INS-1",note:"Fluid low",version:"2",status:"open",deferral_policy:{reason:"Wait"},source_completed_at:"2026-10-10",source_location_id:"l",workorder_id:null,workorder_status:null,visit_started_at:"2026-10-12T10:00:00Z"}]})});
  assert.deepEqual(captured.values,["c","a",["l"]]);
  assert.match(captured.sql,/maintenance_obligation_id is not null/);
  assert.match(captured.sql,/status <> 'superseded'/);
  assert.match(captured.sql,/status <> 'resolved_no_workorder'/);
  assert.match(captured.sql,/visit\.started_at is not null/);
  assert.match(captured.sql,/visit_workorder\.started_at is not null/);
  assert.deepEqual(items[0],{id:"obligation",findingId:"f",inspectionId:"i",inspectionNumber:"INS-1",note:"Fluid low",version:2,status:"open",deferral:{reason:"Wait"},sourceCompletedAt:"2026-10-10",sourceLocationId:"l",workorderId:undefined,workorderStatus:undefined,visitStartedAt:"2026-10-12T10:00:00Z"});
});

test("unit scope lookup never guesses a company", async () => {
  assert.equal(await getMaintenanceAsset({assetId:"a",companyIds:[]},{query:async()=>assert.fail()}),null);
  let values;
  const asset=await getMaintenanceAsset({assetId:"a",companyIds:["c"]},{query:async(_sql,input)=>(values=input,{rows:[{id:"a",company_id:"c",location_id:"l",unit_type:"Truck",unit_no:"12",name:"12"}]})});
  assert.deepEqual(values,["a",["c"]]);
  assert.equal(asset.locationId,"l");
});
