import "./workorder-form-layout.css";

/**
 * The office Create and Detail surfaces intentionally share this small, flat
 * form skeleton.  Modules still own their inputs, permissions and callbacks;
 * this component owns only their visual order.
 */
export function WorkorderFormLayout({
  assignment = null,
  concern = null,
  conversation = null,
  diagnosis = null,
  location = null,
  parts = null,
  schedule = null,
  unit = null,
}) {
  return (
    <div className="accordion-stack workorder-progressive-stack workorder-one-page-stack workorder-form-layout">
      <div className="workorder-form-layout-header">
        <div className="workorder-form-layout-primary">
          {location ? <div className="workorder-form-layout-location workorder-one-page-location-row">{location}</div> : null}
          {unit ? <div className="workorder-one-page-unit-context workorder-form-layout-unit">{unit}</div> : null}
          {concern ? <div className="workorder-form-layout-concern">{concern}</div> : null}
        </div>
        <aside className="workorder-one-page-scheduling workorder-form-layout-schedule" aria-label="Work dates and mechanic">
          {schedule}
          {assignment}
          {conversation}
        </aside>
      </div>
      {diagnosis ? <div className="workorder-form-layout-diagnosis">{diagnosis}</div> : null}
      {parts ? <div className="workorder-form-layout-parts">{parts}</div> : null}
    </div>
  );
}
