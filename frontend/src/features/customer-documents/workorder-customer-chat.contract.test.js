import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("./WorkorderCustomerChat.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8");

test("staff chat uses the Workorder customer-chat contract with exact document scope", () => {
  assert.match(api, /workorders\/\$\{encodeURIComponent\(workorderId\)\}\/customer-chat\?\$\{params\}/);
  assert.match(api, /workorders\/\$\{encodeURIComponent\(workorderId\)\}\/customer-chat`, \{/);
  assert.match(api, /new URLSearchParams\(\{ companyId, locationId, documentId, revisionId \}\)/);
  assert.match(api, /JSON\.stringify\(\{ companyId, locationId, documentId, revisionId, body, idempotencyKey \}\)/);
});

test("customer-audience discussion is explicit, accessible, compact, and text-only", () => {
  assert.match(chat, />Customer audience</);
  assert.match(chat, /separate from internal Workorder chat/);
  assert.match(chat, /does not approve or change the document response/);
  assert.match(chat, /aria-labelledby="workorder-customer-chat-title"/);
  assert.match(chat, /aria-label="Customer-audience message history"/);
  assert.match(chat, /<label htmlFor="workorder-customer-chat-message">Message to customer<\/label>/);
  assert.match(chat, /maxLength="5000"/);
  assert.match(chat, /Send to customer/);
  assert.doesNotMatch(chat, /type="file"|attachment|upload/i);
});

test("chat follows the latest issued customer document without changing response state", () => {
  assert.match(panel, /document=\{invoice \|\| estimate\}/);
  assert.match(chat, /readWorkorderCustomerChat/);
  assert.match(chat, /sendWorkorderCustomerChat/);
  assert.doesNotMatch(chat, /respondToCustomerDocument|responseType|currentResponse/);
});
