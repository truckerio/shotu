import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

const { outputFiles } = buildSync({
  stdin: {
    contents: `import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { WorkorderChatWorkspace } from './WorkorderChatWorkspace.jsx';
      import { ChatComposer } from '../../components/workorders/ChatComposer.jsx';
      import { ChatThread } from '../../components/workorders/ChatThread.jsx';
      export const render = (props) => renderToStaticMarkup(createElement(WorkorderChatWorkspace, {
        companyId: 'company-1', locationId: 'location-1', workorderId: 'wo-1',
        internalContent: createElement('div', null, createElement('p', null, 'Private work note'), createElement(ChatThread, {messages: []}), createElement(ChatComposer, {textareaLabel: 'Internal message'})),
        customerDocument: { documentId: 'document-1', id: 'revision-1' },
        ...props,
      }));`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "jsx",
  },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, logLevel: "silent",
});
const compiled = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

test("internal and customer audiences keep separate mounted histories and composers", () => {
  const internal = compiled.exports.render({ audience: "internal", canReadInternal: true, canReadCustomer: true, canSendCustomer: true });
  assert.match(internal, /Private work note/);
  assert.match(internal, /Visible to customer/);
  assert.match(internal, /Message to customer/);
  assert.match(internal, /data-audience="customer" hidden=""/);

  const customer = compiled.exports.render({ audience: "customer", canReadInternal: true, canReadCustomer: true, canSendCustomer: true });
  assert.match(customer, /data-audience="internal" hidden=""/);
  assert.match(customer, /data-audience="customer"(?! hidden)/);
});

test("customer chat is absent without customer document read access, and read only without write access", () => {
  const denied = compiled.exports.render({ audience: "customer", canReadInternal: true, canReadCustomer: false });
  assert.doesNotMatch(denied, /Message to customer|Visible to customer/);
  assert.match(denied, /Private work note/);

  const readOnly = compiled.exports.render({ audience: "customer", canReadInternal: false, canReadCustomer: true, canSendCustomer: false });
  assert.doesNotMatch(readOnly, /Private work note|Message to customer|Send to customer/);
  assert.match(readOnly, /Visible to customer/);
});

test("customer chat explains a missing issued document without exposing a composer", () => {
  const html = compiled.exports.render({ audience: "customer", canReadInternal: true, canReadCustomer: true, customerDocument: null });
  assert.match(html, /No issued customer document yet/);
  assert.doesNotMatch(html, /Message to customer/);
});

test("both audiences render the shared chat thread and prompt, while customer composer stays text-only and bounded", () => {
  const html = compiled.exports.render({ audience: "customer", canReadInternal: true, canReadCustomer: true, canSendCustomer: true });
  assert.equal((html.match(/class="chat-thread /g) || []).length, 2);
  assert.equal((html.match(/class="chat-prompt-surface /g) || []).length, 2);
  const customer = html.slice(html.indexOf('data-audience="customer"'));
  assert.match(customer, /maxLength="5000"/i);
  assert.match(customer, /aria-label="Send to customer"/);
  assert.doesNotMatch(customer, /type="file"|chat-camera-button|chat-message-receipt/);
});

test("customer composer defaults to read only when write permission is omitted", () => {
  const html = compiled.exports.render({ audience: "customer", canReadInternal: false, canReadCustomer: true });
  assert.match(html, /class="chat-thread /);
  assert.doesNotMatch(html, /chat-prompt-surface|Send to customer/);
});
