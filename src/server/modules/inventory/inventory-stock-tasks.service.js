import { z } from 'zod';
import { listStockTasks,readStockTask,stockTaskSnapshot,saveStockTask } from '../../db/repositories/inventory-stock-tasks.repo.js';
import { stockTaskQuery,stockTaskDetailQuery,stockTaskCommand } from './inventory-stock-tasks.schemas.js';
import { InventoryError } from './inventory.errors.js';
import { resolveInventoryLocationScope } from './inventory-effective-scope.js';
async function scope(context,locationId,dependencies={}){
 const resolveScope=dependencies.resolveInventoryLocationScope||resolveInventoryLocationScope;
 const effective=await resolveScope(context,locationId,{code:'INVENTORY_TASK_FORBIDDEN',message:'Stock tasks require Office or Admin access.'});
 return {...effective,locationIds:effective.isAdmin?[]:[...(context.locationIds||[])]};
}
export function assertSupportedStockTaskCommand(command){
 if(['count','approve_count','recount','cancel_count'].includes(command.action))throw new InventoryError('Use Inventory locations > Position count for physical counts; stock tasks cannot write a second count ledger.',{code:'INVENTORY_POSITION_COUNT_REQUIRED',statusCode:409});
 return command;
}
export async function getStockTasks(params,context){const input=stockTaskQuery.parse(Object.fromEntries(params));return listStockTasks({...await scope(context,input.locationId),...input});}
export async function getStockTask(taskId,params,context,dependencies={}){const input=stockTaskDetailQuery.parse({taskId,...Object.fromEntries(params)});return (dependencies.readStockTask||readStockTask)({...await scope(context,input.locationId,dependencies),...input});}
export async function getStockTaskSnapshot(params,context){const input=z.object({locationId:z.string().uuid(),catalogPartId:z.string().uuid()}).strict().parse(Object.fromEntries(params));return stockTaskSnapshot({...await scope(context,input.locationId),...input});}
export async function postStockTask(body,context){const command=assertSupportedStockTaskCommand(stockTaskCommand.parse(body));return saveStockTask({...await scope(context,command.locationId),locationId:command.locationId,command});}
