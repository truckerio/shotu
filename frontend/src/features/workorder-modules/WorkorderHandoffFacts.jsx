import { workorderHandoffFacts } from "../workorder-detail/workorder-handoff.js";
import { interfaceText } from "../../i18n/index.js";

export function WorkorderHandoffFacts({ workorder, locale }) {
  const t = (key) => interfaceText(locale || "en", key);
  return (
    <dl className="workorder-handoff-facts" aria-label={locale ? t("completion.timing") : "Workorder timing"}>
      {workorderHandoffFacts(workorder, locale ? { locale, localeText: t } : undefined).map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}{fact.detail ? <small>{fact.detail}</small> : null}</dd>
        </div>
      ))}
    </dl>
  );
}
