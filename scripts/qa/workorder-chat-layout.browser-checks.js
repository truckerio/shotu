import assert from "node:assert/strict";

async function checkComposerBottom(page, audience, label) {
  const section = page.locator(`.workorder-chat-workspace [data-audience="${audience}"]`);
  await section.locator("textarea").waitFor({ state: "visible" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await section.evaluate(element => {
    const view = element.closest(".workorder-tools-panel-view");
    const composer = element.querySelector(".chat-prompt-composer");
    const thread = element.querySelector(".chat-thread");
    const viewBox = view.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return { bottomGap: viewBox.bottom - composerBox.bottom, composerTop: composerBox.top,
      threadBottom: thread.getBoundingClientRect().bottom, threadHeight: thread.clientHeight,
      threadScrollHeight: thread.scrollHeight, viewOverflow: view.scrollHeight - view.clientHeight,
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  assert.ok(geometry.bottomGap >= 0 && geometry.bottomGap <= 28, `${label} ${audience}: composer must sit at pane bottom ${JSON.stringify(geometry)}`);
  assert.ok(geometry.threadBottom <= geometry.composerTop, `${label}: history must not overlap composer`);
  assert.ok(geometry.threadHeight >= 80, `${label}: history keeps usable space`);
  assert.ok(geometry.viewOverflow <= 1, `${label}: only message history scrolls`);
  assert.ok(geometry.pageWidth <= geometry.viewportWidth + 1, `${label}: no horizontal page overflow`);
  console.log(JSON.stringify({ chatLayout: label, audience, ...geometry }));
  return geometry;
}

export async function checkWorkorderChatLayout({ page, baseUrl, workorderId, addHistory, artifacts }) {
  try {
    for (const [width, height] of [[1440, 900], [1800, 1200], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${baseUrl}/?workorder=${workorderId}&section=chat`);
      await page.getByRole("tab", { name: "Internal", exact: true }).waitFor({ state: "visible" });
      for (const audience of ["internal", "customer"]) {
        await page.getByRole("tab", { name: audience === "internal" ? "Internal" : "Customer", exact: true }).click();
        await checkComposerBottom(page, audience, `${width}x${height}`);
        if (artifacts && audience === "internal") await page.screenshot({ path: `${artifacts}/chat-${width}x${height}.png` });
      }
    }
    await addHistory();
    await page.reload();
    await page.getByRole("tab", { name: "Internal", exact: true }).click();
    await page.getByText("Chat layout regression message 40", { exact: true }).waitFor({ state: "visible" });
    const geometry = await checkComposerBottom(page, "internal", "long history");
    assert.ok(geometry.threadScrollHeight > geometry.threadHeight, `Long history scrolls within its own area: ${JSON.stringify(geometry)}`);
    const draft = page.locator('[data-audience="internal"] textarea');
    await draft.fill("Retained internal layout draft");
    await page.getByRole("tab", { name: "Customer", exact: true }).click();
    const customerDraft = page.getByRole("textbox", { name: "Message to customer", exact: true });
    await customerDraft.fill("Retained customer layout draft");
    await page.getByRole("tab", { name: "Internal", exact: true }).click();
    assert.equal(await draft.inputValue(), "Retained internal layout draft");
    await draft.fill("");
    await page.getByRole("tab", { name: "Customer", exact: true }).click();
    assert.equal(await customerDraft.inputValue(), "Retained customer layout draft");
    await customerDraft.fill("");
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}
