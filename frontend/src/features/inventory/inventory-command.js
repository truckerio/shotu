import { api } from '../../lib/api.js';
// Each caller persists the immutable request before entering this function.
// An uncertain command must be looked up before any repeated write.
export async function sendInventoryCommand({request,recover=false,url},requestApi=api){
 if(recover){
  const outcome=await requestApi(`/api/office/inventory/purchasing/command?${new URLSearchParams({locationId:request.locationId,idempotencyKey:request.idempotencyKey})}`);
  if(outcome.status==='posted')return outcome;
  if(outcome.status!=='not_found')throw new Error('The saved action status is unavailable. Check again before continuing.');
 }
 return requestApi(url,{method:'POST',body:JSON.stringify(request)});
}
export function inventoryCommandCanBeEdited(error){
 return [400,403,404,409,422].includes(error.status)&&!String(error.message).includes('already used');
}
