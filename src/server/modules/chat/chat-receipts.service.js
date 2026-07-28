import { acknowledgeChatMessageReceiptsThrough } from "../../db/repositories/chat.repo.js";
import { resourceNotFound } from "../../auth/errors.js";

export async function acknowledgeChatReceipts(
  { workorderId, actorUserId, throughMessageId, status },
  dependencies = {},
) {
  const acknowledge = dependencies.acknowledge || acknowledgeChatMessageReceiptsThrough;
  const result = await acknowledge({
    workorderId,
    actorUserId,
    throughMessageId,
    status,
  });
  if (!result) throw resourceNotFound("Chat message");
  return result;
}
