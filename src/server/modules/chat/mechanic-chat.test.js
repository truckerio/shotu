import assert from "node:assert/strict";
import test from "node:test";
import { processMechanicChatMessage } from "./mechanic-chat.service.js";

function dependencies(overrides = {}) {
  const calls = { requests: [], systems: [], types: [] };
  return {
    calls,
    value: {
      addMessage: async ({ body, attachment }) => ({
        id: "message-1",
        body,
        messageType: "normal",
        attachment: attachment ? { id: "attachment-1", fileName: attachment.fileName } : null,
      }),
      persistAttachment: async () => ({ storageKey: "stored.png", fileName: "part.png", mimeType: "image/png", byteSize: 10, sha256: "abc" }),
      removeAttachment: async () => {},
      getContext: async () => ({ mechanic_ids: ["mechanic-1"] }),
      createRequest: async (_workorderId, input) => {
        calls.requests.push(input);
        return { id: "request-1", ...input };
      },
      updateMessageType: async (input) => calls.types.push(input),
      addSystemMessage: async (input) => calls.systems.push(input),
      ...overrides,
    },
  };
}

test("photo ambiguity fails open as a persisted normal message when AI fails", async () => {
  const deps = dependencies({ identifyPart: async () => { throw new Error("AI unavailable"); } });
  const result = await processMechanicChatMessage("wo-1", {
    senderUserId: "mechanic-1",
    messageType: "normal",
    body: "What is this?",
    attachment: { dataUrl: "data:image/png;base64,test", fileName: "part.png" },
  }, deps.value);
  assert.equal(result.message.messageType, "normal");
  assert.equal(result.partRequest, null);
  assert.equal(result.intelligence.status, "ai_unavailable_normal_message");
  assert.equal(deps.calls.requests.length, 0);
});

test("commit-time retry reuses message and removes the redundant uploaded file", async () => {
  const removed = [];
  let addInput = null;
  const result = await processMechanicChatMessage("wo-1", {
    senderUserId: "mechanic-1",
    clientMessageId: "33333333-3333-4333-8333-333333333333",
    messageType: "normal",
    body: "Repair update",
    attachment: { dataUrl: "data:image/png;base64,test", fileName: "retry.png" },
  }, {
    persistAttachment: async () => ({
      storageKey: "redundant-retry.png",
      fileName: "retry.png",
      mimeType: "image/png",
      byteSize: 10,
      sha256: "abc",
    }),
    removeAttachment: async (storageKey) => removed.push(storageKey),
    getContext: async () => ({}),
    identifyPart: async () => null,
    addMessage: async (input) => {
      addInput = input;
      return {
        id: "committed-message",
        body: "Repair update",
        messageType: "normal",
        attachment: { id: "committed-attachment", fileName: "original.png" },
        deduplicated: true,
      };
    },
  });

  assert.match(addInput.dedupeKey, /^client-message:mechanic-1:/);
  assert.deepEqual(removed, ["redundant-retry.png"]);
  assert.equal(result.message.id, "committed-message");
  assert.equal(result.partRequest, null);
});

test("obvious request remains structured when identification is unavailable", async () => {
  const deps = dependencies({ identifyPart: async () => { throw new Error("AI unavailable"); } });
  const result = await processMechanicChatMessage("wo-1", {
    senderUserId: "mechanic-1",
    messageType: "normal",
    body: "Need a fuel pump",
  }, deps.value);
  assert.equal(result.message.messageType, "part_request");
  assert.equal(result.partRequest.description, "fuel pump");
  assert.equal(result.intelligence.pricingSearched, false);
  assert.equal(deps.calls.systems.length, 1);
});

test("identification populates part and editable repair-order suggestion", async () => {
  const deps = dependencies({
    identifyPart: async () => ({
      part: {
        status: "matched",
        normalizedPartNumber: "LF9009",
        manufacturer: "Fleetguard",
        description: "Lube filter",
        category: "engine_oil_filter",
        suggestedQuantity: 1,
        repairOrder: "Replace lube filter and inspect for leaks.",
        fitmentStatus: "possible",
        confidence: 85,
        evidenceSummary: "Candidate only.",
        cautions: [],
      },
      sources: [{ url: "https://example.com/part" }],
    }),
  });
  const result = await processMechanicChatMessage("wo-1", {
    senderUserId: "mechanic-1",
    messageType: "normal",
    body: "Need LF9009",
  }, deps.value);
  assert.equal(result.partRequest.partNumber, "LF9009");
  assert.equal(result.partRequest.repairOrder, "Replace lube filter and inspect for leaks.");
  assert.equal(result.partRequest.sourceChatMessageId, "message-1");
  assert.equal(result.intelligence.pricingSearched, false);
});

test("mechanic classification details are passed to deterministic identification", async () => {
  let identificationInput = null;
  const deps = dependencies({
    identifyPart: async (input) => {
      identificationInput = input;
      return {
        resolutionSource: "mechanic_input",
        part: {
          status: "ambiguous",
          normalizedPartNumber: "ZX-9911",
          description: "ZX-9911",
          suggestedQuantity: 1,
          fitmentStatus: "unknown",
        },
        sources: [],
      };
    },
  });
  await processMechanicChatMessage("wo-1", {
    senderUserId: "mechanic-1",
    messageType: "normal",
    body: "Need ZX-9911",
  }, deps.value);

  assert.equal(identificationInput.partNumber, "ZX-9911");
  assert.equal(identificationInput.partDescription, "ZX-9911");
  assert.equal(deps.calls.requests[0].rawContext.identification.resolutionSource, "mechanic_input");
});
