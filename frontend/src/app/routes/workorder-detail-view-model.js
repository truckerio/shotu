import { visibleConversationMessages } from "../../components/workorders/chat-messages.js";

export function assignedMechanicIdsFromDetail(detail) {
  return detail?.workorder?.mechanics?.map((mechanic) => mechanic.id)
    || (detail?.workorder?.mechanic?.id ? [detail.workorder.mechanic.id] : []);
}

export function conversationMessagesFromDetail(detail) {
  if (!detail) return [];
  const officeNote = detail.workorder.officeNotes
    ? [{
      id: "office-note",
      senderRole: "office",
      senderName: "Office",
      messageType: "normal",
      body: detail.workorder.officeNotes,
      createdAt: null,
    }]
    : [];
  return visibleConversationMessages([...officeNote, ...(detail.messages || [])]);
}

export function pendingPartRequestCount(detail) {
  return (detail?.partRequests || [])
    .filter((request) => !["approved", "rejected", "cancelled"].includes(request.status))
    .length;
}
