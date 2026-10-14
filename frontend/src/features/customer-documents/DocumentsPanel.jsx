import { WorkorderToolsPanel } from "../../components/workorders/WorkorderToolsPanel.jsx";

/** Reuse the existing responsive supporting-panel and focus behavior. */
export function DocumentsPanel({ open, title = "Documents", onClose, children }) {
  return <WorkorderToolsPanel open={open} onClose={onClose} title={title}
    id="workorder-documents-panel" activeView="documents"
    views={[{ id: "documents", label: title, content: children }]} />;
}
