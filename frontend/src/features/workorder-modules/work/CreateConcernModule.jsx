import { FormField, FormSection, NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function CreateConcernModule({ access, activeSection, errors, form, locale = "en", onChange }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection id="concern" className="create-workorder-card" title={t("create.concern.title")} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted showTitle={false}>
      <FormSection
        title={t("create.concern.problem")}
        action={<SectionHelpDisclosure label={t("create.concern.summary")}><p>{t("create.concern.summary")}</p><p>{t("create.concern.hint")}</p></SectionHelpDisclosure>}
      ><FormField id="workorder-concern" label={t("create.concern.mechanicConcern")} error={errors?.mechanicConcern} required requiredLabel={t("create.required")}>
        <NarrativeField locale={locale} rows="4" value={form.mechanicConcern} onChange={(event) => onChange("mechanicConcern", event.target.value)} />
      </FormField></FormSection>
    </ProgressiveWorkorderSection>
  );
}
