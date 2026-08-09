import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderTimelinePanel } from "../../../components/workorders/WorkorderTimeline.jsx";
import { timelineEventCount } from "../../../components/workorders/workorder-timeline-model.js";
import { WorkorderHandoffFacts } from "../WorkorderHandoffFacts.jsx";

export function WorkorderActivityModule({
  access,
  activeWorkorder,
  detailSection,
  isMechanicDetail,
  onSelect,
  visibleTimeline,
}) {
  if (!access || !activeWorkorder) return null;
  const activityCount = timelineEventCount(visibleTimeline);
  return (
    <ProgressiveWorkorderSection
      id="activity"
      title="Activity"
      summary={`${activityCount} ${activityCount === 1 ? "event" : "events"}`}
      activeSection={detailSection}
      onSelect={onSelect}
      className="is-detail-end-timeline"
      displayMode="panel"
    >
      {isMechanicDetail ? <WorkorderHandoffFacts workorder={activeWorkorder.workorder} /> : null}
      <WorkorderTimelinePanel
        timeline={visibleTimeline}
        participants={activeWorkorder.participants || []}
        className="is-control-timeline"
      />
    </ProgressiveWorkorderSection>
  );
}
