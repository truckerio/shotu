export function isSystemChatMessage(message) {
  return message?.senderRole === "system" || message?.messageType === "system";
}

export function visibleConversationMessages(messages = []) {
  return messages.filter((message) => !isSystemChatMessage(message));
}
