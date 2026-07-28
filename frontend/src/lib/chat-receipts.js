import { api } from "./api.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CHAT_RECEIPT_STATUS = Object.freeze({
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
});

export function isSystemChatMessage(message) {
  return message?.senderRole === "system" || message?.messageType === "system";
}

export function latestIncomingChatMessage(messages, currentUserId) {
  return [...(messages || [])].reverse().find((message) => (
    UUID_PATTERN.test(message?.id || "")
    && message?.senderUserId
    && message.senderUserId !== currentUserId
    && !isSystemChatMessage(message)
  )) || null;
}

export function canReadChat({ chatActive, documentVisible, windowFocused }) {
  return Boolean(chatActive && documentVisible && windowFocused);
}

export function receiptDisplayStatus(receipt) {
  if (receipt?.status === CHAT_RECEIPT_STATUS.READ || Number(receipt?.readCount) > 0) {
    return CHAT_RECEIPT_STATUS.READ;
  }
  if (receipt?.status === CHAT_RECEIPT_STATUS.DELIVERED || Number(receipt?.deliveredCount) > 0) {
    return CHAT_RECEIPT_STATUS.DELIVERED;
  }
  return CHAT_RECEIPT_STATUS.SENT;
}

export function shouldRenderMessageReceipt({ currentUserId, message }) {
  return Boolean(currentUserId && message?.senderUserId === currentUserId && !isSystemChatMessage(message));
}

export function createChatReceiptAckTracker() {
  const progress = new Map();

  function stateFor(workorderId) {
    if (!progress.has(workorderId)) {
      progress.set(workorderId, {
        deliveredId: "",
        readId: "",
        pendingDeliveredId: "",
        pendingReadId: "",
      });
    }
    return progress.get(workorderId);
  }

  return {
    claim(workorderId, messageId, status) {
      const state = stateFor(workorderId);
      const completedKey = status === CHAT_RECEIPT_STATUS.READ ? "readId" : "deliveredId";
      const pendingKey = status === CHAT_RECEIPT_STATUS.READ ? "pendingReadId" : "pendingDeliveredId";
      if (state[completedKey] === messageId || state[pendingKey] === messageId) return false;
      state[pendingKey] = messageId;
      return true;
    },
    complete(workorderId, messageId, status, succeeded) {
      const state = stateFor(workorderId);
      const completedKey = status === CHAT_RECEIPT_STATUS.READ ? "readId" : "deliveredId";
      const pendingKey = status === CHAT_RECEIPT_STATUS.READ ? "pendingReadId" : "pendingDeliveredId";
      if (state[pendingKey] === messageId) state[pendingKey] = "";
      if (!succeeded) return;
      state[completedKey] = messageId;
      if (status === CHAT_RECEIPT_STATUS.READ) state.deliveredId = messageId;
    },
    snapshot(workorderId) {
      return { ...stateFor(workorderId) };
    },
  };
}

export async function acknowledgeChatReceipt({
  role,
  workorderId,
  throughMessageId,
  status,
}) {
  return api(`/api/${role}/workorders/${encodeURIComponent(workorderId)}/message-receipts`, {
    method: "POST",
    body: JSON.stringify({ throughMessageId, status }),
  });
}
