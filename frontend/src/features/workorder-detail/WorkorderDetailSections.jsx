import { Button } from "../../components/ui/Button.jsx";
import { FormField as OperationalFormField } from "../../components/forms/index.js";
import { AssetLocationCard, getVehicleLocation } from "../../components/workorders/AssetLocationCard.jsx";
import { PartRequestsPanel } from "../../components/workorders/PartRequestsPanel.jsx";
import { ProgressiveWorkorderSection } from "../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderTimelinePanel } from "../../components/workorders/WorkorderTimeline.jsx";
import { MechanicProgressStatus } from "../mechanic/progress/MechanicProgressStatus.jsx";
import { Field } from "../generator/GeneratorUi.jsx";
import { workDateRangeLabel } from "../../../../shared/workorder-template.js";
import {
  workorderDetailSectionMode,
  workorderNeedsChatAttention,
} from "./workorder-detail-sections.js";

export function WorkorderDetailSections({
  activeWorkorder,
  assignedMechanicIds,
  conversationMessages,
  detailMechanicNames,
  detailSection,
  detailStatus,
  filledPartCount,
  form,
  isCompact,
  isMechanicDetail,
  isOfficeDetail,
  mapsConfig,
  mechanicAction,
  mechanicMapLocation,
  mechanicMapVehicle,
  mechanicProgress,
  mechanicUnitType,
  mechanicVehicleLabel,
  officeAssignment,
  officeAssignmentChanged,
  officeDetailState,
  officeLocations,
  pendingPartCount,
  selectedVehicle,
  vehicleLookup,
  visibleTimeline,
  workorderChatContent,
  applyVehicle,
  reloadActiveWorkorder,
  saveActiveUsedParts,
  saveMechanicWorkNotes,
  saveOfficeWorkorder,
  selectOfficeLocation,
  setDetailSection,
  setOfficeAssignment,
  updateActiveUsedParts,
  updateField,
  updateOfficeMechanicTeam,
  updateStartDate,
  updateUnitNumber,
  vehicleMileage,
  vehicleModelText,
}) {
  return (
    <div className="accordion-stack workorder-progressive-stack">
      {activeWorkorder && isCompact ? (
        <ProgressiveWorkorderSection
          id="chat"
          title={isOfficeDetail ? "Chat with mechanic" : "Messages with office"}
          summary={`${conversationMessages.length} ${conversationMessages.length === 1 ? "message" : "messages"}`}
          activeSection={detailSection}
          onSelect={setDetailSection}
          attention={workorderNeedsChatAttention(detailStatus)}
          className="chat-section"
          displayMode={workorderDetailSectionMode()}
        >
          {workorderChatContent}
        </ProgressiveWorkorderSection>
      ) : null}

      {isMechanicDetail ? (
        <ProgressiveWorkorderSection
          id="work"
          title="Work performed"
          summary={form.workPerformed ? "Repair details added" : "Diagnosis and repair details"}
          activeSection={detailSection}
          onSelect={setDetailSection}
          className="mechanic-work-section"
          displayMode={workorderDetailSectionMode()}
        >
          <div className="operational-form detail-workflow-fields">
            <OperationalFormField id="mechanic-diagnosis" label="Diagnosis" hint="What did you inspect or find?">
              <textarea rows="3" value={form.diagnosis} onChange={(event) => updateField("diagnosis", event.target.value)} />
            </OperationalFormField>
            <OperationalFormField id="mechanic-work-performed" label="Repair completed" hint="Write what was repaired, replaced, adjusted, or checked.">
              <textarea rows="4" value={form.workPerformed} onChange={(event) => updateField("workPerformed", event.target.value)} />
            </OperationalFormField>
            <MechanicProgressStatus status={mechanicProgress.status} error={mechanicProgress.error} />
            <Button type="button" variant="secondary" onClick={saveMechanicWorkNotes} disabled={Boolean(mechanicAction.busy)}>
              {mechanicAction.busy === "notes" ? "Saving..." : "Save progress"}
            </Button>
          </div>
        </ProgressiveWorkorderSection>
      ) : null}

      {isOfficeDetail ? (
        <ProgressiveWorkorderSection
          id="work"
          title={detailStatus === "mechanic_done" ? "Review completed work" : "Work review"}
          summary={officeDetailState.message || (form.workPerformed ? "Mechanic details available" : "Office notes and repair progress")}
          activeSection={detailSection}
          onSelect={setDetailSection}
          attention={detailStatus === "mechanic_done"}
          displayMode={workorderDetailSectionMode()}
        >
          <div className="workorder-review-content">
            <div className="workorder-review-copy">
              <div><span>Diagnosis</span><p>{form.diagnosis || "No diagnosis recorded yet."}</p></div>
              <div><span>Work performed</span><p>{form.workPerformed || "No completed work recorded yet."}</p></div>
            </div>
            <Field label="Office notes">
              <textarea value={form.officeNotes} onChange={(event) => updateField("officeNotes", event.target.value)} rows="3" />
            </Field>
            <Button variant="primary" onClick={saveOfficeWorkorder} disabled={officeDetailState.busy}>
              {officeDetailState.busy ? "Saving" : "Save changes"}
            </Button>
            {officeDetailState.message ? <p className="mechanic-action-message" role="status">{officeDetailState.message}</p> : null}
          </div>
        </ProgressiveWorkorderSection>
      ) : null}

      <ProgressiveWorkorderSection
        id="parts"
        title={isMechanicDetail ? "Parts used" : "Parts"}
        summary={pendingPartCount ? `${pendingPartCount} awaiting action` : `${filledPartCount} recorded`}
        activeSection={detailSection}
        onSelect={setDetailSection}
        attention={pendingPartCount > 0}
        displayMode={workorderDetailSectionMode()}
      >
        <div id={isMechanicDetail ? "mechanic-parts-section" : undefined}>
          <PartRequestsPanel
            role={isOfficeDetail ? "office" : "mechanic"}
            detail={activeWorkorder}
            parts={form.parts}
            onPartsChange={updateActiveUsedParts}
            onSaveParts={saveActiveUsedParts}
            onChanged={reloadActiveWorkorder}
          />
        </div>
      </ProgressiveWorkorderSection>

      {isOfficeDetail ? (
        <>
          <ProgressiveWorkorderSection
            id="unit"
            title={`${form.unitType || "Unit"} details`}
            summary={[form.unitNo, form.customerCompanyName].filter(Boolean).join(" · ") || "Unit and customer information"}
            activeSection={detailSection}
            onSelect={setDetailSection}
            displayMode={workorderDetailSectionMode()}
          >
            <div className="workorder-unit-content">
              {officeLocations.length ? (
                <Field label="Location">
                  <select value={form.locationId} onChange={(event) => selectOfficeLocation(event.target.value)}>
                    {officeLocations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <div className="two-col">
                <div className="unit-field-wrap">
                  <label className="field">
                    <span className="field-label-row">
                      Unit no.
                      <button
                        className="help-dot"
                        type="button"
                        aria-label="Unit lookup help"
                        title="Type a unit, truck name, VIN, or plate. Choose a Samsara match to fill VIN, mileage, license, and model."
                      >
                        ?
                      </button>
                    </span>
                    <input
                      aria-label="Unit no."
                      aria-autocomplete="list"
                      aria-controls="vehicle-suggestions"
                      aria-expanded={vehicleLookup.results.length > 0}
                      role="combobox"
                      value={form.unitNo}
                      onChange={(event) => updateUnitNumber(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  {vehicleLookup.loading ? <p className="vehicle-inline-status">Searching...</p> : null}
                  {vehicleLookup.results.length ? (
                    <div className="vehicle-results" id="vehicle-suggestions" role="listbox" aria-label="Vehicle suggestions">
                      {vehicleLookup.results.map((vehicle) => (
                        <button type="button" role="option" aria-selected="false" key={vehicle.id} onClick={() => applyVehicle(vehicle)}>
                          <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed vehicle"}</strong>
                          <span>
                            {[vehicle.unit_type, vehicle.owner_name, vehicleModelText(vehicle), vehicle.vin, vehicle.license_plate, vehicleMileage(vehicle) ? `${vehicleMileage(vehicle)} mi` : "", getVehicleLocation(vehicle) ? "Map" : ""].filter(Boolean).join(" / ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="two-col">
                <Field label="Start date">
                  <input type="date" value={form.workStartDate} onChange={(event) => updateStartDate(event.target.value)} />
                </Field>
                <Field label="End date">
                  <input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => updateField("workEndDate", event.target.value)} />
                </Field>
              </div>
              <div className="two-col">
                <Field label="Unit type">
                  <select value={form.unitType} onChange={(event) => updateField("unitType", event.target.value)}>
                    <option value="">Select type</option>
                    <option value="Truck">Truck</option>
                    <option value="Trailer">Trailer</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="License">
                  <input value={form.licenseNo} onChange={(event) => updateField("licenseNo", event.target.value)} />
                </Field>
              </div>
              <div className="two-col">
                <Field label="Mileage">
                  <input value={form.mileage} onChange={(event) => updateField("mileage", event.target.value)} />
                </Field>
                <Field label="Model">
                  <input value={form.model} onChange={(event) => updateField("model", event.target.value)} />
                </Field>
              </div>
              <div className="two-col">
                <Field label="Customer company">
                  <input value={form.customerCompanyName} onChange={(event) => updateField("customerCompanyName", event.target.value)} />
                </Field>
                <Field label="VIN no.">
                  <input value={form.vinNo} onChange={(event) => updateField("vinNo", event.target.value)} />
                </Field>
              </div>
              <AssetLocationCard
                vehicle={selectedVehicle}
                location={getVehicleLocation(selectedVehicle)}
                mapsConfig={mapsConfig}
              />
              <Field label="Mechanic concern">
                <input value={form.mechanicConcern} onChange={(event) => updateField("mechanicConcern", event.target.value)} />
              </Field>
            </div>
          </ProgressiveWorkorderSection>

          <ProgressiveWorkorderSection
            id="team"
            title="Mechanics"
            summary={detailMechanicNames || "Unassigned"}
            activeSection={detailSection}
            onSelect={setDetailSection}
            attention={!assignedMechanicIds.length}
            displayMode={workorderDetailSectionMode()}
          >
            <div className="workorder-team-content">
              {isOfficeDetail && !["closed", "odoo_entered"].includes(detailStatus) ? (
                <div className="office-assignment-control">
                  <fieldset className="office-mechanic-team">
                    <legend>Assigned mechanics</legend>
                    {(activeWorkorder.assignableMechanics || []).map((mechanic) => {
                      const checked = officeAssignment.mechanicUserIds.includes(mechanic.id);
                      return (
                        <label key={mechanic.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setOfficeAssignment((current) => ({
                              ...current,
                              mechanicUserIds: checked
                                ? current.mechanicUserIds.filter((id) => id !== mechanic.id)
                                : [...current.mechanicUserIds, mechanic.id],
                            }))}
                          />
                          <span>{mechanic.name}</span>
                        </label>
                      );
                    })}
                    {!(activeWorkorder.assignableMechanics || []).length ? <p>No mechanics assigned to this location.</p> : null}
                  </fieldset>
                  <Field label="Assignment reason">
                    <input
                      aria-label="Assignment reason"
                      value={officeAssignment.reason}
                      onChange={(event) => setOfficeAssignment((current) => ({ ...current, reason: event.target.value }))}
                      placeholder="Why is the team changing?"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={officeDetailState.busy || !officeAssignmentChanged}
                    onClick={updateOfficeMechanicTeam}
                  >
                    Update team
                  </Button>
                </div>
              ) : null}
              <Field label="Mechanic name">
                <input value={form.mechanicName} onChange={(event) => updateField("mechanicName", event.target.value)} />
              </Field>
              <div className="two-col">
                <Field label="Start time">
                  <input type="time" value={form.startTime} onChange={(event) => updateField("startTime", event.target.value)} />
                </Field>
                <Field label="End time">
                  <input type="time" value={form.endTime} onChange={(event) => updateField("endTime", event.target.value)} />
                </Field>
              </div>
              <div className="two-col">
                <Field label="Customer sign">
                  <input value={form.customerSignature} onChange={(event) => updateField("customerSignature", event.target.value)} />
                </Field>
                <Field label="Authorized by">
                  <input value={form.authorizedBy} onChange={(event) => updateField("authorizedBy", event.target.value)} />
                </Field>
              </div>
            </div>
          </ProgressiveWorkorderSection>
        </>
      ) : (
        <ProgressiveWorkorderSection
          id="unit"
          title={`${mechanicUnitType} details`}
          summary={[form.unitNo, form.model].filter(Boolean).join(" · ") || "Unit information"}
          activeSection={detailSection}
          onSelect={setDetailSection}
          displayMode={workorderDetailSectionMode()}
        >
          <dl className="workorder-readonly-details">
            <div><dt>Unit</dt><dd>{form.unitNo || "Not listed"}</dd></div>
            <div><dt>Model</dt><dd>{mechanicVehicleLabel}</dd></div>
            <div><dt>Mileage</dt><dd>{form.mileage ? `${form.mileage} mi` : "Not listed"}</dd></div>
            <div><dt>VIN</dt><dd>{form.vinNo || "Not listed"}</dd></div>
            <div><dt>License</dt><dd>{form.licenseNo || "Not listed"}</dd></div>
            <div><dt>Customer</dt><dd>{form.customerCompanyName || "Not listed"}</dd></div>
            <div><dt>Work dates</dt><dd>{workDateRangeLabel(form) || "Not listed"}</dd></div>
            <div><dt>Workorder</dt><dd>{activeWorkorder.workorder.serial}</dd></div>
          </dl>
          <AssetLocationCard
            vehicle={mechanicMapVehicle}
            location={mechanicMapLocation}
            mapsConfig={mapsConfig}
            showVehicleLabel={false}
          />
        </ProgressiveWorkorderSection>
      )}

      {activeWorkorder ? (
        <ProgressiveWorkorderSection
          id="activity"
          title="Activity"
          summary={`${visibleTimeline.length} events`}
          activeSection={detailSection}
          onSelect={setDetailSection}
          className="is-detail-end-timeline"
          displayMode={workorderDetailSectionMode()}
        >
          <WorkorderTimelinePanel
            timeline={visibleTimeline}
            participants={activeWorkorder.participants || []}
            className="is-control-timeline"
          />
        </ProgressiveWorkorderSection>
      ) : null}
    </div>
  );
}
