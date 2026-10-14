import {
  DEFAULT_WORKORDER_PARTS_COLUMNS,
  WORKORDER_PARTS_COLUMNS,
  WorkorderPartsColumnHead,
  WorkorderPartsRow,
  WorkorderPartsTable,
} from "./WorkorderPartsTable.jsx";

export function workorderPartsEntryColumns(showPrice = false) {
  return showPrice
    ? [...DEFAULT_WORKORDER_PARTS_COLUMNS, WORKORDER_PARTS_COLUMNS.PRICE]
    : DEFAULT_WORKORDER_PARTS_COLUMNS;
}

export function WorkorderPartsEntryTable({
  children,
  className = "",
  laborAction = <span aria-hidden="true"></span>,
  laborAriaLabel,
  laborPrice = null,
  laborProduct,
  laborQuantity,
  laborRepair,
  labels,
  showPrice = false,
  ...tableProps
}) {
  const columns = workorderPartsEntryColumns(showPrice);
  return (
    <WorkorderPartsTable className={className} columns={columns} {...tableProps}>
      <WorkorderPartsColumnHead className="create-parts-column-head" columns={columns} labels={labels} />
      <WorkorderPartsRow className="operational-part-labor-row used-part-labor-row" aria-label={laborAriaLabel}>
        <strong>1</strong>
        {laborProduct}
        {laborQuantity}
        {laborRepair}
        {showPrice ? laborPrice : null}
        {laborAction}
      </WorkorderPartsRow>
      {children}
    </WorkorderPartsTable>
  );
}
