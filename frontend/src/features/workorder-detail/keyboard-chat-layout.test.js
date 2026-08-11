import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const layoutCss = readFileSync(
  new URL("../../components/workorders/workorder-detail-layout.css", import.meta.url),
  "utf8",
);
const chatCss = readFileSync(
  new URL("../../components/workorders/chat/chat.css", import.meta.url),
  "utf8",
);
const composer = readFileSync(
  new URL("../../components/workorders/ChatComposer.jsx", import.meta.url),
  "utf8",
);

test("shared detail page emits one keyboard state contract for every role", () => {
  assert.match(detailPage, /useVisualViewport/);
  assert.match(detailPage, /data-keyboard-open=/);
  assert.match(detailPage, /data-detail-section=/);
  assert.match(detailPage, /--workorder-visual-viewport-height/);
  assert.match(detailPage, /<ChatThread[\s\S]*keyboardOpen=\{viewport\.keyboardOpen\}/);
});

test("compact keyboard mode hides detail navigation and bounds the page to visual viewport", () => {
  assert.match(layoutCss, /@media \(max-width:\s*1180px\)[\s\S]*\.prototype\.workorder-detail-page\.is-keyboard-open\s*\{[^}]*height:\s*var\(--workorder-visual-viewport-height[^}]*position:\s*fixed;/s);
  assert.match(layoutCss, /\.is-keyboard-open\s+\.workorder-section-nav-mobile,[\s\S]*\.mechanic-compact-primary-action\s*\{[^}]*display:\s*none\s*!important;/s);
});

test("chat uses remaining height with internal message scrolling and keyboard-following composer", () => {
  assert.match(chatCss, /grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
  assert.match(chatCss, /\.chat-content\s*>\s*\.chat-thread\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(chatCss, /\.is-keyboard-open\s+\.chat-content\s*>\s*\.chat-prompt-composer\s*\{[^}]*bottom:\s*0;[^}]*position:\s*sticky;/s);
});

test("shared composer keeps multiline behavior while advertising send keyboard action", () => {
  assert.match(composer, /enterKeyHint="send"/);
  assert.match(composer, /shouldSubmitChatKey\(event\)/);
});
