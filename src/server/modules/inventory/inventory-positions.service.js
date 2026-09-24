import { z } from "zod";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import {
  createInventoryPositionSchema, updateInventoryPositionSchema, moveInventoryPositionSchema,
  startPositionCountSchema, recordPositionCountSchema, addPositionCountFoundPartSchema, recordPositionCountIdentitySchema, submitPositionCountSchema, applyPositionCountSchema,
} from "./inventory-position.schemas.js";
import {
  listInventoryPositions, insertInventoryPosition, patchInventoryPosition, getPartPositions, moveInventoryStock,
  listPositionStock, createPositionCount, getPositionCount, savePositionCountObservation, addPositionCountFoundPart, savePositionCountIdentity, submitPositionCountObservations, applyPositionCountCorrection,
} from "../../db/repositories/inventory-positions.repo.js";

const uuid=z.string().uuid();
const positionStockScope=z.enum(["direct","subtree"]);
const fail=(code,message,statusCode=409)=>{throw new InventoryError(message,{code,statusCode});};
const scope=(context)=>({actorId:context.actor.id,companyIds:[...context.companyIds],locationIds:[...context.locationIds],isAdmin:context.actor.role==="admin"});
const requireManager=(context)=>{if(!["office","admin"].includes(context.actor.role))fail("INVENTORY_LOCATION_MANAGE_FORBIDDEN","Only Office or Admin can manage inventory locations.",403);};
const ensureLocation=(locationId,context)=>{if(context.actor.role!=="admin"&&!context.locationIds?.has(locationId))throw inventoryNotFound();};
function map(result){
  if(result.kind==="not_found"||result.kind==="position_not_found"||result.kind==="parent_not_found")throw inventoryNotFound();
  if(result.kind==="stale")fail("INVENTORY_POSITION_STALE","Inventory location data changed. Refresh and try again.");
  if(result.kind==="idempotency_conflict")fail("INVENTORY_POSITION_REPLAY_CONFLICT","This request key was already used with different details.");
  if(result.kind==="conflict")fail("INVENTORY_POSITION_CODE_CONFLICT","That inventory location code is already used in this shop.");
  if(result.kind==="invalid_parent_kind")fail("INVENTORY_POSITION_HIERARCHY_INVALID","That sublocation type does not fit inside the selected location.",422);
  if(result.kind==="archive_blocked")fail("INVENTORY_POSITION_ARCHIVE_BLOCKED","Move stock and archive child locations before archiving this location.");
  if(result.kind==="destination_not_eligible")fail("INVENTORY_POSITION_MOVE_UNSUPPORTED","Stock can currently move only between active available locations.",422);
  if(result.kind==="reconciliation_required")fail("INVENTORY_POSITION_RECONCILIATION_REQUIRED","This stock balance must be reconciled before position operations can continue.");
  if(result.kind==="tracking_mismatch")fail("INVENTORY_POSITION_TRACKING_MISMATCH","The movement does not match this part's tracking method.",422);
  if(result.kind==="unit_conflict")fail("INVENTORY_POSITION_UNIT_CONFLICT","One or more exact units moved or changed before this operation.");
  if(result.kind==="insufficient_available")fail("INVENTORY_POSITION_INSUFFICIENT_AVAILABLE","The source location does not have enough unreserved stock.");
  if(result.kind==="incomplete")fail("INVENTORY_POSITION_COUNT_INCOMPLETE","Count at least one part and finish every selected serialized part before continuing.");
  if(result.kind==="reserved_conflict")fail("INVENTORY_POSITION_COUNT_RESERVED","The counted quantity cannot be lower than stock reserved at this position.");
  if(result.kind==="stock_busy")fail("INVENTORY_POSITION_STOCK_BUSY","This count or its stock is being updated. Wait a moment, then apply this count again.");
  if(result.kind==="stock_conflict")fail("INVENTORY_POSITION_STOCK_CONFLICT","The accounted stock changed before this correction could apply.");
  if(result.kind==="unsupported_uom")fail("INVENTORY_POSITION_UOM_PRECISION","The quantity does not match this part's tracking method and unit precision.",422);
  if(result.kind==="serialized_review_required")fail("INVENTORY_POSITION_SERIAL_COUNT_REVIEW","Count exact identities separately before applying aggregate corrections.",422);
  if(result.kind==="found_part_exists")fail("INVENTORY_POSITION_FOUND_PART_EXISTS","This part is already included in the physical count.");
  if(result.kind==="catalog_changed")fail("INVENTORY_CATALOG_PART_CHANGED","Part details changed. Select the part again before counting it.");
  if(result.kind==="serial_not_found")fail("INVENTORY_POSITION_SERIAL_NOT_FOUND","This serial identity was not found in your inventory.",404);
  if(result.kind==="serial_wrong_position")fail("INVENTORY_POSITION_SERIAL_WRONG_POSITION","This serial identity belongs to a different storage position.");
  if(result.kind==="serial_snapshot_stale")fail("INVENTORY_POSITION_STALE","Inventory changed after this count started. Restart the count.");
  return result;
}

export async function readInventoryPositions(locationId,context,dependencies={}){locationId=uuid.parse(locationId);ensureLocation(locationId,context);
  return {positions:await(dependencies.listPositions||listInventoryPositions)({...scope(context),locationId})};}
export async function createInventoryPosition(locationId,rawInput,context,dependencies={}){locationId=uuid.parse(locationId);ensureLocation(locationId,context);requireManager(context);
  const result=map(await(dependencies.insertPosition||insertInventoryPosition)({...scope(context),locationId,...createInventoryPositionSchema.parse(rawInput)}));return{position:result.position,replayed:result.kind==="replay"};}
export async function updateInventoryPosition(positionId,rawInput,context,dependencies={}){positionId=uuid.parse(positionId);requireManager(context);
    const result=map(await(dependencies.patchPosition||patchInventoryPosition)({...scope(context),positionId,...updateInventoryPositionSchema.parse(rawInput)}));return{position:result.position};}
export async function readPositionStock(locationId,positionId,rawScope,context,dependencies={}){locationId=uuid.parse(locationId);positionId=uuid.parse(positionId);ensureLocation(locationId,context);
  const value=await(dependencies.listPositionStock||listPositionStock)({...scope(context),locationId,positionId,scope:positionStockScope.parse(rawScope??"direct")});if(!value)throw inventoryNotFound();return value;}
export async function readPartPositions(partId,locationId,context,dependencies={}){partId=uuid.parse(partId);locationId=uuid.parse(locationId);ensureLocation(locationId,context);
  const value=await(dependencies.getPartState||getPartPositions)({...scope(context),partId,locationId});if(!value)throw inventoryNotFound();return value;}
export async function moveInventoryPosition(partId,locationId,rawInput,context,dependencies={}){partId=uuid.parse(partId);locationId=uuid.parse(locationId);ensureLocation(locationId,context);requireManager(context);
  const result=map(await(dependencies.moveStock||moveInventoryStock)({...scope(context),partId,locationId,move:moveInventoryPositionSchema.parse(rawInput)}));return{operation:result.operation,replayed:result.kind==="replay"};}
export async function startPositionCount(locationId,rawInput,context,dependencies={}){locationId=uuid.parse(locationId);ensureLocation(locationId,context);requireManager(context);const input=startPositionCountSchema.parse(rawInput);
  const result=map(await(dependencies.createCount||createPositionCount)({...scope(context),locationId,...input}));return{count:{...result.count,canApply:context.actor.role==="admin"},replayed:result.kind==="replay"};}
export async function readPositionCount(countId,context,dependencies={}){countId=uuid.parse(countId);const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});if(!value)throw inventoryNotFound();return{count:{...value,canApply:context.actor.role==="admin"}};}
export async function recordPositionCount(countId,lineId,rawInput,context,dependencies={}){countId=uuid.parse(countId);lineId=uuid.parse(lineId);requireManager(context);const input=recordPositionCountSchema.parse(rawInput);
  const result=map(await(dependencies.saveObservation||savePositionCountObservation)({...scope(context),countId,lineId,...input}));const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});return{count:{...value,canApply:context.actor.role==="admin"},replayed:result.kind==="replay"};}
export async function recordPositionCountFoundPart(countId,rawInput,context,dependencies={}){countId=uuid.parse(countId);requireManager(context);const input=addPositionCountFoundPartSchema.parse(rawInput);
  const result=map(await(dependencies.addFoundPart||addPositionCountFoundPart)({...scope(context),countId,...input}));const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});return{count:{...value,canApply:context.actor.role==="admin"},replayed:result.kind==="replay"};}
export async function recordPositionCountIdentity(countId,rawInput,context,dependencies={}){countId=uuid.parse(countId);requireManager(context);const input=recordPositionCountIdentitySchema.parse(rawInput);
  const result=map(await(dependencies.saveIdentity||savePositionCountIdentity)({...scope(context),countId,...input}));const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});return{count:{...value,canApply:context.actor.role==="admin"},replayed:result.kind==="replay",alreadyObserved:Boolean(result.alreadyObserved)};}
export async function submitPositionCount(countId,rawInput,context,dependencies={}){countId=uuid.parse(countId);requireManager(context);const input=submitPositionCountSchema.parse(rawInput);
  const result=map(await(dependencies.submitCount||submitPositionCountObservations)({...scope(context),countId,...input}));const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});return{count:{...value,canApply:context.actor.role==="admin"},replayed:result.kind==="replay"};}
export async function applyPositionCount(countId,rawInput,context,dependencies={}){countId=uuid.parse(countId);if(context.actor.role!=="admin")fail("INVENTORY_COUNT_APPLY_FORBIDDEN","Only Admin can apply inventory count corrections.",403);const input=applyPositionCountSchema.parse(rawInput);
  const result=map(await(dependencies.applyCount||applyPositionCountCorrection)({...scope(context),countId,...input}));const value=await(dependencies.getCount||getPositionCount)({...scope(context),countId});return{count:{...value,canApply:true},replayed:result.kind==="replay"};}
