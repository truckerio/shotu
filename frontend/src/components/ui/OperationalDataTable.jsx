import { useContext } from "react";
import { Cell, Column, Row, Table, TableBody, TableHeader, TableStateContext } from "react-aria-components";
import "./operational-data-table.css";

export function OperationalDataTable({ ariaLabel, columns, children, className = "" }) {
  return <div className={`operational-data-table-frame ${className}`.trim()}>
    <Table aria-label={ariaLabel} className="operational-data-table">
      <TableHeader>
        {columns.map((column) => <Column key={column.id} id={column.id} isRowHeader={column.isRowHeader}>
          {column.label}
        </Column>)}
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  </div>;
}

export function OperationalDataRow(props) {
  return <Row {...props} />;
}

function OperationalDataCellContent({ children }) {
  const tableState = useContext(TableStateContext);

  function containEditorNavigation(event) {
    if (event.target !== event.currentTarget
      && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) {
      event.stopPropagation();
    }
  }

  function beginEditing(event) {
    if (event.target !== event.currentTarget) tableState?.setKeyboardNavigationDisabled(true);
  }

  function endEditing(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) tableState?.setKeyboardNavigationDisabled(false);
  }

  return <div className="operational-data-cell-content" onBlurCapture={endEditing} onFocusCapture={beginEditing} onKeyDown={containEditorNavigation}>{children}</div>;
}

export function OperationalDataCell({ label, children, className = "", ...props }) {
  return <Cell data-label={label} className={className} {...props}><OperationalDataCellContent>{children}</OperationalDataCellContent></Cell>;
}
