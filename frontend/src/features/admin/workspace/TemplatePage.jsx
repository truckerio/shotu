import { useMemo } from "react";
import { NarrativeField } from "../../../components/forms/NarrativeField.jsx";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { Button } from "../../../components/ui/Button.jsx";
import { emptyPart, renderWorkorderPageHtml } from "../../../../../shared/workorder-template.js";

function previewForm(location, template) {
  return {
    ...template,
    companyName: location.name,
    mechanicConcern: "Air leak inspection",
    unitNo: "1042",
    unitType: "Truck",
    workStartDate: new Date().toISOString().slice(0, 10),
    workEndDate: new Date().toISOString().slice(0, 10),
    licenseNo: "8ABC123",
    mileage: "428,190",
    model: "Cascadia",
    vinNo: "1FUJ...1042",
    mechanicName: "Mechanic Name",
    startTime: "08:00",
    endTime: "",
    managerName: "",
    customerSignature: "",
    authorizedBy: "",
    parts: [emptyPart(), emptyPart(), emptyPart()],
  };
}

export function TemplatePage({ detail, value, onChange, onSave, saving }) {
  const preview = useMemo(() => previewForm(detail.location, value), [detail.location, value]);
  return (
    <section className="admin-template-layout">
      <div className="admin-template-form">
        <div className="admin-panel-header"><h2>Workorder template</h2><Button variant="primary" onClick={onSave} disabled={saving}>{saving ? "Saving" : "Save template"}</Button></div>
        <label><span>Header title</span><NarrativeField singleLine value={value.headerTitle} onChange={(event) => onChange("headerTitle", event.target.value)} /></label>
        <div className="admin-two-col"><label><span>Brand top</span><input {...textEntryProps("name")} value={value.brandTop} onChange={(event) => onChange("brandTop", event.target.value)} /></label><label><span>Brand bottom</span><input {...textEntryProps("name")} value={value.brandBottom} onChange={(event) => onChange("brandBottom", event.target.value)} /></label></div>
        <label><span>Warranty footer</span><NarrativeField singleLine value={value.warrantyText} onChange={(event) => onChange("warrantyText", event.target.value)} /></label>
        <label><span>Responsibility footer</span><NarrativeField rows="3" value={value.responsibilityText} onChange={(event) => onChange("responsibilityText", event.target.value)} /></label>
        <label><span>Authorization footer</span><NarrativeField rows="5" value={value.authorizationText} onChange={(event) => onChange("authorizationText", event.target.value)} /></label>
      </div>
      <div className="admin-template-preview"><div dangerouslySetInnerHTML={{ __html: renderWorkorderPageHtml(preview, "WO-000001") }} /></div>
    </section>
  );
}

export function WorkorderRulesPage({ policy, onChange, onSave, saving }) {
  return (
    <section className="admin-panel admin-rules-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Workorder rules</h2>
          <p>Control what mechanics can enter for work completed at this location.</p>
        </div>
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving" : "Save rules"}
        </Button>
      </div>
      <label className="admin-rule-row">
        <span>
          <strong>Mechanics can record parts used</strong>
          <small>When off, mechanics can still request parts and message the office.</small>
        </span>
        <input
          type="checkbox"
          checked={policy.mechanicCanRecordParts}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </section>
  );
}
