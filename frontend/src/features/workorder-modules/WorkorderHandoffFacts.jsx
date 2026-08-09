import { workorderHandoffFacts } from "../workorder-detail/workorder-handoff.js";

export function WorkorderHandoffFacts({ workorder }) {
  return (
    <dl className="workorder-handoff-facts" aria-label="Workorder timing">
      {workorderHandoffFacts(workorder).map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}{fact.detail ? <small>{fact.detail}</small> : null}</dd>
        </div>
      ))}
    </dl>
  );
}
