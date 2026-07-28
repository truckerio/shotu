import { useCallback, useEffect, useRef } from "react";
import {
  CHAT_RECEIPT_STATUS,
  acknowledgeChatReceipt,
  canReadChat,
  createChatReceiptAckTracker,
  latestIncomingChatMessage,
} from "../../../lib/chat-receipts.js";

export function useChatReceipts({
  active,
  currentUserId,
  messages,
  role,
  workorderId,
}) {
  const trackerRef = useRef(null);
  if (!trackerRef.current) trackerRef.current = createChatReceiptAckTracker();

  const acknowledge = useCallback(async (messageId, status) => {
    const tracker = trackerRef.current;
    if (!tracker.claim(workorderId, messageId, status)) return true;
    try {
      await acknowledgeChatReceipt({
        role,
        workorderId,
        throughMessageId: messageId,
        status,
      });
      tracker.complete(workorderId, messageId, status, true);
      return true;
    } catch {
      tracker.complete(workorderId, messageId, status, false);
      return false;
    }
  }, [role, workorderId]);

  useEffect(() => {
    if (!currentUserId || !role || !workorderId) return undefined;
    const latestIncoming = latestIncomingChatMessage(messages, currentUserId);
    if (!latestIncoming) return undefined;
    let cancelled = false;

    const acknowledgeCurrentState = async () => {
      const delivered = await acknowledge(latestIncoming.id, CHAT_RECEIPT_STATUS.DELIVERED);
      if (cancelled || !delivered) return;
      if (!canReadChat({
        chatActive: active,
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
      })) return;
      await acknowledge(latestIncoming.id, CHAT_RECEIPT_STATUS.READ);
    };

    void acknowledgeCurrentState();
    const acknowledgeOnForeground = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        void acknowledgeCurrentState();
      }
    };
    document.addEventListener("visibilitychange", acknowledgeOnForeground);
    window.addEventListener("focus", acknowledgeOnForeground);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acknowledgeOnForeground);
      window.removeEventListener("focus", acknowledgeOnForeground);
    };
  }, [acknowledge, active, currentUserId, messages, role, workorderId]);
}
