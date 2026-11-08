import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const output = buildSync({ stdin: { contents: `import {createElement} from 'react';import{renderToStaticMarkup}from'react-dom/server';import{CustomerDocumentRenderer}from'./CustomerDocumentRenderer.jsx';export const render=p=>renderToStaticMarkup(createElement(CustomerDocumentRenderer,{projection:p}));`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
test('short document notes share one region without oversized heading sections', () => {
  const html = module.exports.render({ terms: 'Payment due on receipt.', authorizationText: 'Approved scope only.', warrantyText: 'Warranty <safe>', footer: 'Thank you.' });
  assert.equal((html.match(/aria-label="Terms and notes"/g) || []).length, 1);
  for (const text of ['Payment due on receipt.', 'Approved scope only.', 'Warranty &lt;safe&gt;', 'Thank you.']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<h2>(Terms|Authorization|Warranty)<\/h2>/);
});
test('absent notes add no empty footer and invoice uses work-performed heading', () => {
  const html = module.exports.render({ type: 'invoice' });
  assert.doesNotMatch(html, /aria-label="Terms and notes"/);
  assert.match(html, /Work performed/);
});
