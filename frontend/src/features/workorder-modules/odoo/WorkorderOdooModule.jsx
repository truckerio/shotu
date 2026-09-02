import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";
import { WorkorderOdooPanel } from "./WorkorderOdooPanel.jsx";
import {
  isWorkorderOdooEligible,
  missingOdooWorkorderFields,
  workorderMissingInfoHandoff,
} from "./workorder-odoo-model.js";

export function WorkorderOdooModule({
  access,
  activeWorkorder,
  controller,
  detailSection,
  detailStatus,
  fieldAccess,
  onSelect,
}) {
  if (!access || !controller) return null;
  return (
    <ProgressiveWorkorderSection
      id="odoo"
      title="Odoo"
      summary={activeWorkorder.workorder.odooServiceOrderNo
        ? `Draft ${activeWorkorder.workorder.odooServiceOrderNo}`
        : activeWorkorder.workorder.odooStatus === "missing_info"
          ? "Waiting for information"
          : undefined}
      headerAction={<SectionHelpDisclosure label="Odoo help"><p>Odoo entry becomes available after the mechanic finishes and office approves this workorder.</p></SectionHelpDisclosure>}
      activeSection={detailSection}
      onSelect={onSelect}
      attention={activeWorkorder.workorder.odooStatus === "missing_info"}
      displayMode="panel"
    >
      <WorkorderOdooPanel
        access={access}
        controller={controller}
        eligible={isWorkorderOdooEligible(detailStatus)}
        fieldAccess={fieldAccess}
        missing={missingOdooWorkorderFields(activeWorkorder.workorder)}
        missingInfoHandoff={workorderMissingInfoHandoff(activeWorkorder.workorder, activeWorkorder.timeline)}
        workorder={activeWorkorder.workorder}
      />
    </ProgressiveWorkorderSection>
  );
}
