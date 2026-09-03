function nextPaint(popup) {
  return new Promise((resolve) => {
    if (typeof popup.requestAnimationFrame === "function") popup.requestAnimationFrame(() => resolve());
    else popup.setTimeout(resolve, 0);
  });
}

export async function renderAndPrintInspectionSlip(popup, html) {
  if (!popup) throw new Error("Allow pop-ups to print the inspection slip.");

  let finishLoad;
  const loaded = new Promise((resolve) => { finishLoad = resolve; });
  popup.addEventListener("load", finishLoad, { once: true });
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  if (popup.document.readyState === "complete") finishLoad();

  await loaded;
  if (popup.document.fonts?.ready) await popup.document.fonts.ready;
  popup.focus();
  await nextPaint(popup);
  await nextPaint(popup);
  popup.print();
}
