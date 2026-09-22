import { purchaseApprovalSettings } from '../../db/repositories/purchase-approval-settings.repo.js';
import { purchaseApprovalScopeSchema, purchaseApprovalSettingsSchema } from './inventory-purchasing.schemas.js';
import { createHash, randomUUID } from "node:crypto";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { postLocalInventoryReceipt } from "../../db/repositories/local-inventory.repo.js";
import { purchaseCommand,readPurchasing,readPurchaseCommand,readPurchaseOrderForReceipt } from "../../db/repositories/inventory-purchasing.repo.js";
import { z } from 'zod';
import { purchaseCommandSchema,purchaseReceiptSchema,purchaseScopeSchema } from "./inventory-purchasing.schemas.js";
import { resolveInventoryLocationScope } from './inventory-effective-scope.js';
import { InventoryError } from './inventory.errors.js';
import { assertInventoryQrConfigured } from './inventory-qr.js';
import { withInventoryLabels } from './inventory-receiving.service.js';
const purchasingScope=(context,locationId,dependencies={})=>resolveInventoryLocationScope(context,locationId,{loadLocation:dependencies.loadLocation,code:'PURCHASING_FORBIDDEN',message:'Purchasing requires Office or Admin access.'});
export async function getPurchasing(searchParams,context,dependencies={}){const input=purchaseScopeSchema.parse(Object.fromEntries(searchParams));return readPurchasing({...await purchasingScope(context,input.locationId,dependencies),...input});}
export async function savePurchase(input,context,dependencies={}){const command=purchaseCommandSchema.parse(input);return purchaseCommand({...await purchasingScope(context,command.locationId,dependencies),locationId:command.locationId,command});}

const receiptFailure=(code,message)=>new InventoryError(message,{code,statusCode:409});
export async function receivePurchaseOrder(orderId,input,context,dependencies={}){
  const parsed=purchaseReceiptSchema.parse(input);
  const scope=await purchasingScope(context,parsed.locationId,dependencies);
  const order=await (dependencies.readPurchaseOrder||readPurchaseOrderForReceipt)({...scope,locationId:parsed.locationId,orderId});
  const lineById=new Map(order.lines.map(line=>[line.id,line]));
  const receiptId=randomUUID(), postingLines=[], outcomes=[];
  for(let index=0;index<parsed.lines.length;index+=1){
    const received=parsed.lines[index],line=lineById.get(received.purchaseLineId);
    if(!line||!line.catalog_part_id||!line.tracking_mode)throw receiptFailure('INVENTORY_TRACKING_REQUIRED','Review the purchase part and its tracking before receiving.');
    const unit=getUnitDefinition(line.current_uom_code||line.uom_code); if(!unit||unit.category==='time')throw receiptFailure('INVENTORY_UOM_INVALID','The purchase line stocking unit is unavailable.');
    const quantities=[received.acceptedQuantity,received.heldQuantity,received.rejectedQuantity,received.notReceivedQuantity];
    if(quantities.some(value=>Math.round(value*10**unit.decimalScale)/10**unit.decimalScale!==value))throw receiptFailure('INVENTORY_QUANTITY_INVALID',`Receipt quantity does not match ${line.uom_code} precision.`);
    const actual=received.acceptedQuantity+received.heldQuantity+received.rejectedQuantity;
    const remaining=Number(line.quantity)-Number(line.received_quantity)-Number(line.cancelled_quantity);
    if(received.acceptedQuantity>remaining||(received.outcome!=='over'&&actual+received.notReceivedQuantity>remaining))throw receiptFailure('INVENTORY_PURCHASE_RECEIPT_CONFLICT','Receipt quantities exceed the purchase order quantity still open.');
    if(line.tracking_mode==='serialized'){
      if(quantities.some(value=>!Number.isInteger(value)))throw receiptFailure('INVENTORY_SERIAL_QUANTITY_INVALID','Serialized quantities must be whole units.');
      if(received.serialNumbers.length&&received.serialNumbers.length!==received.acceptedQuantity+received.heldQuantity)throw receiptFailure('INVENTORY_SERIAL_QUANTITY_INVALID','Capture one identity for every accepted or held serialized unit.');
      if(new Set(received.serialNumbers.map(value=>value.toLocaleUpperCase('en-US'))).size!==received.serialNumbers.length)throw receiptFailure('INVENTORY_SERIAL_IDENTITY_DUPLICATE','Each received identity must be different.');
    }else if(received.serialNumbers.length)throw receiptFailure('INVENTORY_SERIAL_IDENTITY_NOT_ALLOWED','This part does not use individual identities.');
    const receiptLineId=actual>0?randomUUID():null;
    if(receiptLineId)postingLines.push({
      id:receiptLineId,lineIndex:index,catalogPartId:line.catalog_part_id,expectedPartVersion:Number(line.part_version),
      normalizedPartNumber:String(line.part_number).toUpperCase().replace(/[^A-Z0-9]/g,''),partNumber:line.part_number,description:line.description,
      quantity:actual,acceptedQuantity:received.acceptedQuantity,heldQuantity:received.heldQuantity,rejectedQuantity:received.rejectedQuantity,
      targetPositionId:received.targetPositionId,
      uomCode:line.current_uom_code||line.uom_code,trackingMode:line.tracking_mode,unitCost:line.unit_price===null?null:Number(line.unit_price),
      lineTotal:line.unit_price===null?null:Number((actual*Number(line.unit_price)).toFixed(2)),currency:order.currency,costSource:line.unit_price===null?'unknown':'purchase_order',
      serializedUnits:line.tracking_mode==='serialized'?Array.from({length:received.acceptedQuantity+received.heldQuantity},(_,ordinal)=>({id:randomUUID(),ordinal:ordinal+1,
        serialNumber:received.serialNumbers[ordinal]||`WG-L-${receiptId.replaceAll('-','').slice(0,16).toUpperCase()}-${index+1}-${ordinal+1}`,conditionCode:'unknown',status:ordinal<received.acceptedQuantity?'in_stock':'held'})):[],
    });
    outcomes.push({purchaseLineId:line.id,receiptLineId,catalogPartId:line.catalog_part_id,partNumber:line.part_number,uomCode:line.uom_code,
      expectedQuantity:actual+received.notReceivedQuantity,actualQuantity:actual,usableQuantity:received.acceptedQuantity,
      heldQuantity:received.heldQuantity,rejectedQuantity:received.rejectedQuantity,notReceivedQuantity:received.notReceivedQuantity,
      outcome:received.outcome,notes:received.notes,holdLocation:received.holdLocation});
  }
  const serializedCount=postingLines.reduce((sum,line)=>sum+line.serializedUnits.length,0);if(serializedCount)assertInventoryQrConfigured(dependencies.qrOptions);
  const requestShape={
    orderId,expectedVersion:parsed.expectedVersion,locationId:parsed.locationId,reference:parsed.reference,
    lines:parsed.lines,
    outcomes:outcomes.map(({receiptLineId:_receiptLineId,...outcome})=>outcome),
  };
  const result=await (dependencies.postReceipt||postLocalInventoryReceipt)({receiptId,runId:null,actorId:context.actor.id,...scope,
    idempotencyKey:parsed.idempotencyKey,requestHash:createHash('sha256').update(JSON.stringify(requestShape)).digest('hex'),reviewedRunVersion:null,
    physicalConfirmation:'physically_received',confirmationHash:createHash('sha256').update(JSON.stringify({...requestShape,actorId:context.actor.id})).digest('hex'),
    labelBatchId:serializedCount?randomUUID():null,lines:postingLines,receiptOutcomes:outcomes,
    direct:{locationId:parsed.locationId,purchaseOrderId:orderId,expectedOrderVersion:parsed.expectedVersion,reference:parsed.reference}});
  if(result.kind==='replay')return {recorded:true,replayed:true,receipt:withInventoryLabels(result.receipt,dependencies.qrOptions)};
  if(result.kind==='target_position_invalid')throw new InventoryError('Receipt target position is not eligible.',{code:'INVENTORY_RECEIPT_POSITION_INVALID',statusCode:422});
  if(result.kind==='serial_conflict')throw receiptFailure('INVENTORY_SERIAL_IDENTITY_DUPLICATE','One of these serialized identities is already recorded in inventory.');
  if(result.kind!=='posted')throw receiptFailure('INVENTORY_PURCHASE_RECEIPT_CONFLICT','The purchase order or its remaining quantities changed. Refresh it before receiving.');
  return {recorded:true,replayed:false,receipt:withInventoryLabels(result.receipt,dependencies.qrOptions)};
}
export async function getPurchaseCommand(searchParams,context,dependencies={}){const input=z.object({locationId:z.string().uuid(),idempotencyKey:z.string().uuid()}).strict().parse(Object.fromEntries(searchParams));return readPurchaseCommand({...await purchasingScope(context,input.locationId,dependencies),...input});}

export async function getPurchaseApprovalSettings(params, context, dependencies = {}) {
  const input = purchaseApprovalScopeSchema.parse(Object.fromEntries(params));
  const authorized = await settingsScope(context, input.locationId, dependencies);
  return purchaseApprovalSettings({ ...authorized, ...input });
}
export async function savePurchaseApprovalSettings(body, context, dependencies = {}) {
  const changes = purchaseApprovalSettingsSchema.parse(body);
  const authorized = await settingsScope(context, changes.locationId, dependencies);
  return purchaseApprovalSettings({ ...authorized, locationId: changes.locationId }, changes);
}
function settingsScope(context, locationId, dependencies) {
  return resolveInventoryLocationScope(context, locationId, { loadLocation:dependencies.loadLocation,allowedRoles:['admin'],code:'PURCHASE_SETTINGS_FORBIDDEN',message:'Only Admin can change purchase order approval settings.' });
}
