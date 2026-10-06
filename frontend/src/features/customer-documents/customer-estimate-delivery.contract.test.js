import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const delivery = readFileSync(new URL("./CustomerEstimateDelivery.jsx", import.meta.url), "utf8");
const review = readFileSync(new URL("./CustomerDocumentReview.jsx", import.meta.url), "utf8");

test("estimate delivery posts the grant secret only in its body and preserves manual link fallback", () => {
  assert.match(api, /\/api\/customer-documents\/grants\/\$\{encodeURIComponent\(grantId\)\}\/email/);
  assert.match(api, /rawToken, recipientEmail: recipientEmail \|\| null, idempotencyKey/);
  assert.match(page, /grantId: customerGrant\.id, rawToken: customerGrant\.rawToken/);
  assert.match(review, /Copy customer link/);
});

test("delivery status is honest about provider acceptance, configuration, and failures", () => {
  assert.match(delivery, /Accepted by email provider\. This is not proof/);
  assert.match(delivery, /Email not configured/);
  assert.match(delivery, /Email failed—copy link instead/);
  assert.doesNotMatch(delivery, /delivered/i);
});
