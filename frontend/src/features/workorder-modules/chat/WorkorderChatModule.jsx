import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";

export function WorkorderChatModule({
  access,
  activeWorkorder,
  attention,
  conversationMessages,
  detailSection,
  isCompact,
  isMechanicDetail,
  label,
  onSelect,
  content,
}) {
  if (!access || !activeWorkorder || (!isCompact && !isMechanicDetail)) return null;
  return (
    <ProgressiveWorkorderSection
      id="chat"
      title={label}
      summary={`${conversationMessages.length} ${conversationMessages.length === 1 ? "message" : "messages"}`}
      activeSection={detailSection}
      onSelect={onSelect}
      attention={attention}
      className="chat-section"
      displayMode="panel"
    >
      {content}
    </ProgressiveWorkorderSection>
  );
}
