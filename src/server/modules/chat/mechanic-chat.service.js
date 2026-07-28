import {
  addChatMessage,
  addSystemChatMessageOnce,
  chatMessageDedupeKey,
  getMechanicChatContext,
  updateChatMessageType,
} from "../../db/repositories/chat.repo.js";
import { createPartRequest } from "../../db/repositories/part-requests.repo.js";
import { classifyMechanicPartIntent } from "./chat-part-intent.js";
import { identifyMechanicChatPart } from "./chat-part-identification.service.js";
import { persistChatImageAttachment, removeStoredChatImage } from "./chat-media.service.js";

function summarizedIdentification(part, resolutionSource) {
  if (!part) return "";
  const identity = [part.normalizedPartNumber, part.description].filter(Boolean).join(" - ");
  if (resolutionSource === "company_catalog") {
    return `Matched company part: ${identity}. Office must verify fitment before approval.`;
  }
  if (resolutionSource === "mechanic_input") {
    return `Part request saved exactly as entered: ${identity || "part number"}. No company-approved match exists yet; office verification is required.`;
  }
  if (part.status === "matched") {
    return `Part identified for office review: ${identity || "part candidate"}.${part.repairOrder ? ` Suggested work: ${part.repairOrder}` : ""} Office must verify fitment before approval.`;
  }
  return "Part request saved for office review, but an exact part was not identified. Add the part number or a clear label photo when available.";
}

function rawDescription(body, attachment) {
  if (body) return body;
  if (attachment) return `Part shown in ${attachment.fileName}`;
  return "Mechanic part request";
}

export async function processMechanicChatMessage(workorderId, input, dependencies = {}) {
  const persistAttachment = dependencies.persistAttachment || persistChatImageAttachment;
  const removeAttachment = dependencies.removeAttachment || removeStoredChatImage;
  const addMessage = dependencies.addMessage || addChatMessage;
  let storedAttachment = null;
  let message;

  if (input.attachment) storedAttachment = await persistAttachment(input.attachment);
  try {
    message = await addMessage({
      workorderId,
      senderUserId: input.senderUserId,
      senderRole: "mechanic",
      messageType: input.messageType === "help_request" ? "help_request" : "normal",
      body: input.body,
      attachment: storedAttachment,
      dedupeKey: chatMessageDedupeKey(input.senderUserId, input.clientMessageId),
    });
    if (message.deduplicated && storedAttachment) {
      await removeAttachment(storedAttachment.storageKey).catch(() => {});
      storedAttachment = null;
    }
  } catch (error) {
    if (storedAttachment) await removeAttachment(storedAttachment.storageKey).catch(() => {});
    throw error;
  }

  const classification = classifyMechanicPartIntent({
    body: input.body,
    hasAttachment: Boolean(message.attachment),
    messageType: input.messageType,
  });
  if (classification.intent === "normal") {
    return { message, partRequest: null, intelligence: { classification, identification: null, status: "not_part_intent" } };
  }

  const getContext = dependencies.getContext || getMechanicChatContext;
  const workorderContext = await getContext(workorderId);
  let identification = null;
  let identificationError = null;
  if (classification.shouldIdentify) {
    try {
      const identifyPart = dependencies.identifyPart || identifyMechanicChatPart;
      identification = await identifyPart({
        message: input.body,
        imageDataUrl: input.attachment?.dataUrl,
        partNumber: classification.partNumber,
        partDescription: classification.partDescription,
        workorderContext,
      });
    } catch (error) {
      identificationError = error;
    }
  }

  const isDeterministicRequest = classification.intent === "part_request";
  if (!isDeterministicRequest && !identification) {
    return {
      message,
      partRequest: null,
      intelligence: {
        classification,
        identification: null,
        status: "ai_unavailable_normal_message",
        errorCode: identificationError?.code || identificationError?.name || "IDENTIFICATION_FAILED",
      },
    };
  }

  const identifiedPart = identification?.part || null;
  const createRequest = dependencies.createRequest || createPartRequest;
  const partRequest = await createRequest(workorderId, {
    mechanicUserId: input.senderUserId,
    query: input.body || message.attachment?.fileName || "Photo part request",
    partNumber: identifiedPart?.normalizedPartNumber || classification.partNumber || "",
    manufacturer: identifiedPart?.manufacturer || "",
    description: identifiedPart?.description || classification.partDescription || rawDescription(input.body, message.attachment),
    category: identifiedPart?.category || "",
    quantity: identifiedPart?.suggestedQuantity || 1,
    uomCode: identifiedPart?.uomCode || "ea",
    repairOrder: identifiedPart?.repairOrder || "",
    fitmentStatus: identifiedPart?.fitmentStatus || "unknown",
    fitmentNotes: identifiedPart?.evidenceSummary || "Office verification required.",
    sourceChatMessageId: message.id,
    sourceAttachmentId: message.attachment?.id || null,
    rawContext: {
      source: "mechanic_chat",
      message: input.body,
      attachment: message.attachment,
      classification,
      identification: identifiedPart ? {
        status: identifiedPart.status,
        confidence: identifiedPart.confidence,
        resolutionSource: identification.resolutionSource,
        evidenceSummary: identifiedPart.evidenceSummary,
        cautions: identifiedPart.cautions,
        sources: identification.sources,
      } : null,
      identificationError: identificationError ? {
        code: identificationError.code || identificationError.name || "IDENTIFICATION_FAILED",
        message: identificationError.message,
      } : null,
    },
  });

  const updateMessageType = dependencies.updateMessageType || updateChatMessageType;
  await updateMessageType({ workorderId, messageId: message.id, messageType: "part_request" });
  message = { ...message, messageType: "part_request" };

  const addSystemMessage = dependencies.addSystemMessage || addSystemChatMessageOnce;
  await addSystemMessage({
    workorderId,
    body: identifiedPart
      ? summarizedIdentification(identifiedPart, identification.resolutionSource)
      : "Part request saved for office review. Add the exact part number or a clear label photo when available.",
    dedupeKey: `part-identification:${partRequest.id}`,
  });

  return {
    message,
    partRequest,
    intelligence: {
      classification,
      identification: identifiedPart,
      status: identifiedPart ? identifiedPart.status : "request_created_without_identification",
      pricingSearched: false,
    },
  };
}
