import assert from "node:assert/strict";
import test from "node:test";
import { MECHANIC_HELP_ACTIONS, localizedMechanicHelpActions } from "./mechanic-help-prompts.js";

test("mechanic help actions expose one photo action and clear office prompts", () => {
  assert.deepEqual(MECHANIC_HELP_ACTIONS.map(({ id }) => id), [
    "photo",
    "ask-office",
    "report-problem",
  ]);
  assert.equal(MECHANIC_HELP_ACTIONS[0].kind, "photo");
  assert.match(MECHANIC_HELP_ACTIONS[1].prompt, /I need help from the office with/);
  assert.match(MECHANIC_HELP_ACTIONS[2].prompt, /I found another problem:/);
});

test("mechanic help action labels localize without changing prompt payloads", () => {
  const localized = localizedMechanicHelpActions("es");
  assert.equal(localized[0].label, "Tomar foto");
  assert.equal(localized[1].prompt, MECHANIC_HELP_ACTIONS[1].prompt);
});
