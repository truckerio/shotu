import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./chat.css", import.meta.url), "utf8");
const composer = readFileSync(new URL("../ChatComposer.jsx", import.meta.url), "utf8");
const thread = readFileSync(new URL("../ChatThread.jsx", import.meta.url), "utf8");

function mobileChatCss() {
  const marker = "@media (max-width: 640px)";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "phone chat breakpoint must exist");
  return css.slice(start);
}

test("390px and 430px phone chat use a rectangular full-width workspace with inset composer", () => {
  const mobileCss = mobileChatCss();

  assert.match(css, /grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
  assert.match(mobileCss, /\.control-panel:has\(\.workorder-progressive-stack\s*>\s*\.chat-section\)\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;[^}]*padding-bottom:\s*calc\(75px \+ env\(safe-area-inset-bottom\)\);/s);
  assert.match(mobileCss, /\.workorder-section-panel\.chat-section\s*\{[^}]*border:\s*0;/s);
  assert.match(mobileCss, /\.workorder-section-panel\.chat-section\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(mobileCss, /\.chat-content:has\(>\s*\.chat-thread\s*\+\s*\.chat-prompt-composer\)\s*\{[^}]*height:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*clip;[^}]*width:\s*100%;/s);
  assert.match(mobileCss, /\.chat-content\s*>\s*\.chat-thread\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*max-width:\s*100%;[^}]*padding:\s*8px 2px 12px;/s);
  assert.match(mobileCss, /\.chat-content\s*>\s*\.chat-prompt-composer\s*\{[^}]*--chat-composer-inset:\s*clamp\(12px,\s*3\.5vw,\s*16px\);[^}]*max-width:\s*100%;[^}]*padding:\s*8px var\(--chat-composer-inset\) var\(--chat-composer-inset\);[^}]*position:\s*static;[^}]*width:\s*100%;/s);

  for (const viewportWidth of [390, 430]) {
    const inset = Math.min(16, Math.max(12, viewportWidth * 0.035));
    assert.ok(viewportWidth - (inset * 2) < viewportWidth);
    assert.ok(viewportWidth - (inset * 2) > 88, "composer must fit both 44px actions");
  }
});

test("shared composer keeps camera capture, autosize, keyboard submit, and 44px actions", () => {
  assert.match(composer, /accept="image\/\*"/);
  assert.match(composer, /capture="environment"/);
  assert.match(composer, /Math\.min\(event\.target\.scrollHeight,\s*120\)/);
  assert.match(composer, /onKeyDown=\{handleKeyDown\}/);
  assert.match(composer, /await onSend\(buildChatPayload\(body,\s*attachment\)\)/);
  assert.match(css, /grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px;/);
  assert.match(css, /\.chat-camera-button,[\s\S]*?\.chat-send-button\s*\{[\s\S]*?height:\s*44px;[\s\S]*?width:\s*44px;/);
});

test("empty conversation uses shared thread without a bordered placeholder card", () => {
  assert.match(thread, /visibleMessages\.length \? "" : "is-empty"/);
  assert.match(mobileChatCss(), /\.chat-thread\.is-empty\s*\{[^}]*align-content:\s*center;[^}]*min-height:\s*0;/s);
});
