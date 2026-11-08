import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("./WorkorderCustomerChat.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("staff chat uses the Workorder customer-chat contract with exact document scope", () => {
  assert.match(api, /workorders\/\$\{encodeURIComponent\(workorderId\)\}\/customer-chat\?\$\{params\}/);
  assert.match(api, /workorders\/\$\{encodeURIComponent\(workorderId\)\}\/customer-chat`, \{/);
  assert.match(api, /new URLSearchParams\(\{ companyId, locationId, documentId, revisionId \}\)/);
  assert.match(api, /JSON\.stringify\(\{ companyId, locationId, documentId, revisionId, body, idempotencyKey \}\)/);
});

test("customer-audience discussion is explicit, accessible, compact, and text-only", () => {
  assert.match(chat, />Visible to customer</);
  assert.doesNotMatch(chat, />Customer messages<|separate from internal Workorder chat|does not approve or change the document response/);
  assert.match(chat, /aria-label="Customer chat"/);
  assert.match(chat, /<ChatThread/);
  assert.match(chat, /textareaLabel="Message to customer"/);
  assert.match(chat, /maxLength=\{5000\}/);
  assert.match(chat, /allowAttachments=\{false\}/);
  assert.match(chat, /Send to customer/);
  assert.doesNotMatch(chat, /type="file"|upload/i);
});

test("chat follows the latest issued customer document without changing response state", () => {
  assert.match(detail, /customerDocument=\{documentController\.invoice \|\| documentController\.estimate\}/);
  assert.doesNotMatch(panel, /<WorkorderCustomerChat/);
  assert.match(detail, /chatPolicy\.canRead && effectiveChatAudience === "internal"/);
  assert.match(chat, /readWorkorderCustomerChat/);
  assert.match(chat, /sendWorkorderCustomerChat/);
  assert.doesNotMatch(chat, /respondToCustomerDocument|responseType|currentResponse/);
});
