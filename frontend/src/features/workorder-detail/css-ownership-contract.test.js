import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

function facadeDeclarations(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import\s+"[^"]+";/g, "")
    .trim();
}

test("legacy CSS bundles remain import-only compatibility facades", async () => {
  const [legacy, responsive] = await Promise.all([
    read("../../styles/legacy-workspaces.css"),
    read("../../styles/responsive-overlays.css"),
  ]);

  assert.equal(facadeDeclarations(legacy), "");
  assert.equal(facadeDeclarations(responsive), "");
  assert.match(legacy, /workorder-detail-toolbar\.css/);
  assert.match(responsive, /legacy-asset-map\.css/);
  assert.match(responsive, /legacy-preview-layout\.css/);
});

test("feature-owned CSS remains at the historical cascade boundaries", async () => {
  const styles = await read("../../styles.css");
  const imports = [...styles.matchAll(/@import\s+"([^"]+)";/g)].map((match) => match[1]);

  assert.deepEqual(imports.slice(0, 9), [
    "./styles/foundation.css",
    "./components/workorders/legacy-workorder-layout.css",
    "./styles/legacy-workspaces.css",
    "./components/workorders/part-requests/legacy-part-requests.css",
    "./components/preview/legacy-preview-controls.css",
    "./styles/responsive-overlays.css",
    "./components/workorders/workorder-dialogs.css",
    "./components/preview/legacy-responsive-preview.css",
    "./styles/mechanic-detail.css",
  ]);
});

test("workorder dialogs are not owned by the global responsive overlay", async () => {
  const [responsive, dialogs] = await Promise.all([
    read("../../styles/responsive-overlays.css"),
    read("../../components/workorders/workorder-dialogs.css"),
  ]);

  assert.doesNotMatch(responsive, /^\.modal-backdrop\s*\{/m);
  assert.match(dialogs, /^\.modal-backdrop\s*\{/m);
  assert.match(dialogs, /\.mechanic-completion-modal/);
  assert.match(dialogs, /\.office-handoff-modal/);
});

test("legacy styles no longer own extracted part-request or phone preview rules", async () => {
  const [legacy, responsive, partRequests, preview] = await Promise.all([
    read("../../styles/legacy-workspaces.css"),
    read("../../styles/responsive-overlays.css"),
    read("../../components/workorders/part-requests/legacy-part-requests.css"),
    read("../../components/preview/legacy-responsive-preview.css"),
  ]);

  assert.doesNotMatch(legacy, /\.part-requests-panel/);
  assert.match(partRequests, /\.part-requests-panel/);
  assert.doesNotMatch(responsive, /overscroll-behavior-x:\s*contain/);
  assert.match(preview, /@media \(max-width: 700px\)/);
  assert.match(preview, /\.preview-grid\.single/);
});

test("split layout and print controls are owned beside their components", async () => {
  const [legacy, responsive, layout, previewControls] = await Promise.all([
    read("../../styles/legacy-workspaces.css"),
    read("../../styles/responsive-overlays.css"),
    read("../../components/workorders/legacy-workorder-layout.css"),
    read("../../components/preview/legacy-preview-controls.css"),
  ]);

  assert.doesNotMatch(legacy, /\.split-layout/);
  assert.match(layout, /\.split-layout\.workorder-detail-layout/);
  assert.doesNotMatch(responsive, /^\.print-command-menu\s*\{/m);
  assert.match(previewControls, /^\.print-command-menu\s*\{/m);
});

test("chat and timeline styles are owned beside their shared components", async () => {
  const [legacy, responsive, chat, timeline] = await Promise.all([
    read("../../styles/legacy-workspaces.css"),
    read("../../styles/responsive-overlays.css"),
    read("../../components/workorders/chat/chat.css"),
    read("../../components/workorders/workorder-timeline.css"),
  ]);

  assert.doesNotMatch(legacy, /^\.chat-thread\s*\{/m);
  assert.doesNotMatch(legacy, /^\.chat-composer\s*\{/m);
  assert.match(chat, /^\.chat-thread\s*\{/m);
  assert.match(chat, /^\.chat-composer\s*\{/m);

  assert.doesNotMatch(legacy, /^\.workorder-timeline-panel\s*\{/m);
  assert.doesNotMatch(responsive, /\.preview-secondary-pane \.office-timeline/);
  assert.match(timeline, /^\.workorder-timeline-panel\s*\{/m);
  assert.match(timeline, /\.preview-secondary-pane \.office-timeline/);
});

test("role homes and the shared queue no longer depend on legacy workspace CSS", async () => {
  const [legacy, responsive, queue, mechanic, office] = await Promise.all([
    read("../../styles/legacy-workspaces.css"),
    read("../../styles/responsive-overlays.css"),
    read("../../components/workorders/workorder-queue.css"),
    read("../mechanic/mechanic-workspace.css"),
    read("../office/office.css"),
  ]);

  assert.doesNotMatch(legacy, /^\.mechanic-queue-shell\s*\{/m);
  assert.doesNotMatch(responsive, /^\s*\.mechanic-queue-shell\s*\{/m);
  assert.match(queue, /^\.mechanic-queue-shell\s*\{/m);
  assert.match(queue, /^\.mechanic-queue-tabs\s*\{/m);

  assert.doesNotMatch(legacy, /^\.mechanic-home\s*\{/m);
  assert.match(mechanic, /^\.mechanic-home\s*\{/m);
  assert.doesNotMatch(legacy, /^\.office-layout\s*\{/m);
  assert.match(office, /^\.office-layout\s*\{/m);
});

test("visual harness covers phone, tablet, 1080p, and 1920 desktop", async () => {
  const harness = await read("../../../../scripts/visual/css-ownership-viewport.js");

  for (const viewport of [
    '{ name: "phone", width: 390, height: 844 }',
    '{ name: "tablet", width: 768, height: 1024 }',
    '{ name: "desktop-1080", width: 1080, height: 1080 }',
    '{ name: "desktop-1920", width: 1920, height: 1080 }',
  ]) {
    assert.ok(harness.includes(viewport), `missing viewport contract: ${viewport}`);
  }
});
