import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { directReceiptApprovalInternals } from "./direct-receipt-approvals.repo.js";

test("approval detail projects immutable held-arrival disposition and damage evidence", () => {
  const id=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partId=randomUUID(),actorId=randomUUID();
  const detail=directReceiptApprovalInternals.publicDetail({
    id,company_id:companyId,location_id:locationId,catalog_part_id:partId,target_position_id:null,
    submitted_by:actorId,idempotency_key:randomUUID(),request_hash:"hash",status:"pending",version:1,
    original_command:{quantity:2,uomCode:"ea",trackingMode:"quantity",disposition:"held",holdLocation:"Receiving cage",damageDetails:"Bent housing",noPurchaseOrderReason:"Counter delivery"},
    receiver_evidence:{confirmation:"new_company_stock_received"},part_number:"P-1",part_description:"Pump",location_name:"Main shop",submitter_name:"Receiver",
  });
  assert.deepEqual({
    disposition:detail.arrival.disposition,
    holdLocation:detail.arrival.holdLocation,
    damageDetails:detail.arrival.damageDetails,
    destination:detail.destination,
  },{disposition:"held",holdLocation:"Receiving cage",damageDetails:"Bent housing",destination:null});
});

test("legacy accepted approval detail receives safe accepted defaults", () => {
  const detail=directReceiptApprovalInternals.publicDetail({
    id:randomUUID(),company_id:randomUUID(),location_id:randomUUID(),catalog_part_id:randomUUID(),target_position_id:null,
    submitted_by:randomUUID(),idempotency_key:randomUUID(),request_hash:"hash",status:"pending",version:1,
    original_command:{quantity:1,uomCode:"ea",trackingMode:"quantity"},receiver_evidence:{},
  });
  assert.equal(detail.arrival.disposition,"accepted");
  assert.equal(detail.arrival.holdLocation,"");
  assert.equal(detail.arrival.damageDetails,"");
});
