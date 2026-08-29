import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { formatLocaleNumber, interfaceText } from "../../../i18n/index.js";

export function WorkorderChatModule({
  access,
  activeWorkorder,
  attention,
  conversationMessages,
  detailSection,
  isCompact,
  isMechanicDetail,
  renderInDetail = isCompact || isMechanicDetail,
  label,
  locale = "en",
  onSelect,
  content,
}) {
  if (!access || !activeWorkorder || !renderInDetail) return null;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection
      id="chat"
      title={label}
      summary={`${formatLocaleNumber(conversationMessages.length, locale)} ${conversationMessages.length === 1 ? t("chat.messageCount") : t("chat.messagesCount")}`}
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
