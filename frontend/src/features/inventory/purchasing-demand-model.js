export function demandPurchaseLine(row) {
  const buy=Number(row.buy_quantity);
  let uncovered=Math.max(0,Number(row.workorder_quantity)+Number(row.legacy_quantity||0)-Number(row.available_quantity)-Number(row.incoming_quantity));
  const demandSources=[];
  for(const request of row.workorders||[]) {
    const linked=demandSources.reduce((sum,item)=>sum+item.plannedQuantity,0);
    const planned=Math.min(Number(request.requestedQuantity),uncovered,buy-linked);
    if(planned>0)demandSources.push({sourceType:'workorder_request',sourceId:request.requestId,plannedQuantity:planned});
    uncovered-=planned;
  }
  for(const request of row.legacy_requests||[]) {
    const linked=demandSources.reduce((sum,item)=>sum+item.plannedQuantity,0);
    const planned=Math.min(Number(request.requestedQuantity),uncovered,buy-linked);
    if(planned>0)demandSources.push({sourceType:'legacy_request',sourceId:request.requestId,plannedQuantity:planned});
    uncovered-=planned;
  }
  const linked=demandSources.reduce((sum,item)=>sum+item.plannedQuantity,0);
  if(buy-linked>0)demandSources.push({sourceType:'stocking_policy',sourceId:row.catalog_part_id,plannedQuantity:buy-linked});
  return {catalogPartId:row.catalog_part_id,partNumber:row.part_number,description:row.description,uomCode:row.uom_code,quantity:buy,unitPrice:null,demandSources};
}
