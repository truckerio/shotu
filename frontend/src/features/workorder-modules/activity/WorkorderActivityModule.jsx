import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderTimelinePanel } from "../../../components/workorders/WorkorderTimeline.jsx";
import { timelineEventCount } from "../../../components/workorders/workorder-timeline-model.js";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";
import { formatLocaleNumber, interfaceText } from "../../../i18n/index.js";

export function WorkorderActivityModule({
  access,
  activeWorkorder,
  detailSection,
  isMechanicDetail,
  locale = "en",
  onSelect,
  visibleTimeline,
}) {
  if (!access || !activeWorkorder) return null;
  const t = (key) => interfaceText(locale, key);
  const activityCount = timelineEventCount(visibleTimeline);
  return (
    <ProgressiveWorkorderSection
      id="activity"
      title={t("activity.title")}
      summary={`${formatLocaleNumber(activityCount, locale)} ${t(activityCount === 1 ? "activity.event" : "activity.events")}`}
      activeSection={detailSection}
      onSelect={onSelect}
      className="is-detail-end-timeline"
      displayMode="panel"
    >
      {isMechanicDetail ? <WorkorderHandoffFacts workorder={activeWorkorder.workorder} locale={locale} /> : null}
      <WorkorderTimelinePanel
        timeline={visibleTimeline}
        participants={activeWorkorder.participants || []}
        className="is-control-timeline"
        locale={locale}
      />
    </ProgressiveWorkorderSection>
  );
}
