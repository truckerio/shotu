import { ActionFooter, Dropdown, FormCard, FormField, FormSection, OperationalForm, OptionalSection, UnitSummary } from "../../components/forms/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { inspectionUnitTypeLabel } from "./inspection-model.js";
import { useCreateInspectionController } from "./useCreateInspectionController.js";
import "./inspections.css";

export function CreateInspectionPage({ actor, access = {}, locations = [], mechanics = [], units = [], request, onCreated, onCancel }) {
  const form = useCreateInspectionController({ actor, locations, mechanics, units, request, onCreated });
  if (access.canCreate === false) return <section className="inspection-create"><p role="alert">Inspection creation is not available.</p></section>;
  const showLocation = form.locations.length > 1 && !form.selectedUnit?.locationId;
  return <section className="inspection-create">
    <OperationalForm className="inspection-create-form" onSubmit={form.submit} busy={form.state.busy} noValidate>
      <FormCard title="New inspection">
        <div className="inspection-create-layout">
          <div className="inspection-create-primary">
            <FormSection title="Unit">
              {!form.selectedUnit ? <>
                <FormField label="Truck or trailer" required>
                  <input type="search" value={form.unitSearch} onChange={(event) => form.setUnitSearch(event.target.value)} placeholder="Search unit number, VIN, or plate" aria-label="Search truck or trailer" autoFocus />
                </FormField>
                {form.unitSearch ? <section className="inspection-unit-results" aria-label="Matching units">
                  {form.choices.length ? <ul>{form.choices.map((unit) => <li key={unit.id}><button type="button" onClick={() => form.selectUnit(unit)}><strong>{unit.unitNo || unit.name}</strong><span>{inspectionUnitTypeLabel(unit.unitType)}{unit.vin ? ` · ${unit.vin}` : ""}</span></button></li>)}</ul> : <p>No matching units.</p>}
                </section> : null}
              </> : <UnitSummary unit={{ ...form.selectedUnit, unitType: inspectionUnitTypeLabel(form.selectedUnit.unitType) }} onEdit={form.clearSelectedUnit} editLabel="Change unit" />}
              {form.selectedUnit ? <div className="inspection-template-summary"><span>Template</span><strong>{form.template.label}</strong></div> : null}
            </FormSection>
          </div>
          <aside className="inspection-create-support" aria-label="Inspection setup">
            {(showLocation || form.canAssign) ? <FormSection title="Assignment"><div className="operational-form-grid">
              {showLocation ? <FormField label="Location" required><Dropdown value={form.locationId} onChange={(event) => form.setLocationId(event.target.value)} aria-label="Inspection location"><option value="">Select location</option>{form.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></FormField> : null}
              {form.canAssign ? <FormField label="Mechanic" required><Dropdown value={form.mechanicIds[0] || ""} onChange={(event) => form.setMechanicIds(event.target.value ? [event.target.value] : [])} aria-label="Assign mechanic"><option value="">Select mechanic</option>{form.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</Dropdown></FormField> : null}
            </div></FormSection> : null}
            <OptionalSection className="inspection-more-details" title="More details">
              <FormField label="Due date"><input type="date" value={form.dueDate} onChange={(event) => form.setDueDate(event.target.value)} /></FormField>
              <FormField label="Office instructions"><textarea rows="3" value={form.instructions} onChange={(event) => form.setInstructions(event.target.value)} /></FormField>
            </OptionalSection>
            {form.state.error ? <p className="inspection-create-error" role="alert">{form.state.error}</p> : null}
            <ActionFooter stickyOnMobile message={form.selectedUnit ? form.template.label : ""}>
              {onCancel ? <Button type="button" onClick={onCancel}>Cancel</Button> : null}
              <Button variant="primary" type="submit" disabled={form.state.busy}>{form.state.busy ? "Saving..." : form.isMechanic ? "Start inspection" : "Request inspection"}</Button>
            </ActionFooter>
          </aside>
        </div>
      </FormCard>
    </OperationalForm>
  </section>;
}
