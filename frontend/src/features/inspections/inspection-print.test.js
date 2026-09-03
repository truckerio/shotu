import assert from "node:assert/strict";
import test from "node:test";
import { renderAndPrintInspectionSlip } from "./inspection-print.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("inspection printing waits for the popup document, fonts, and a paint", async () => {
  const calls = [];
  const fonts = deferred();
  let onLoad;
  const popup = {
    addEventListener(type, listener) { assert.equal(type, "load"); onLoad = listener; },
    document: {
      readyState: "loading",
      fonts: { ready: fonts.promise.then(() => calls.push("fonts")) },
      open() { calls.push("open"); },
      write(html) { calls.push(["write", html]); },
      close() { calls.push("close"); this.readyState = "complete"; onLoad(); },
    },
    requestAnimationFrame(callback) { calls.push("paint"); callback(); },
    focus() { calls.push("focus"); },
    print() { calls.push("print"); },
  };

  const printing = renderAndPrintInspectionSlip(popup, "<html>slip</html>");
  await Promise.resolve();
  assert.equal(calls.includes("print"), false);
  fonts.resolve();
  await printing;

  assert.deepEqual(calls, ["open", ["write", "<html>slip</html>"], "close", "fonts", "focus", "paint", "paint", "print"]);
});

test("inspection printing reports a blocked popup", async () => {
  await assert.rejects(renderAndPrintInspectionSlip(null, "<html></html>"), /Allow pop-ups/);
});
