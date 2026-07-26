import assert from "node:assert/strict";
import test from "node:test";
import { shouldPromptForWorkorderDraft } from "./workorder-draft.js";

const createScreen = {
  activeWorkorder: null,
  role: "office",
  routeLoading: false,
  search: "?view=create",
  workspace: "generator",
};

test("draft prompt is limited to the explicit create-workorder route", () => {
  assert.equal(shouldPromptForWorkorderDraft(createScreen), true);
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, search: "?workorder=wo-1" }), false);
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, search: "" }), false);
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, workspace: "office" }), false);
});

test("draft prompt stays closed while a saved workorder is loading or open", () => {
  assert.equal(shouldPromptForWorkorderDraft({
    ...createScreen,
    routeLoading: true,
    search: "?workorder=wo-1",
  }), false);
  assert.equal(shouldPromptForWorkorderDraft({
    ...createScreen,
    activeWorkorder: { id: "wo-1" },
  }), false);
});

test("draft prompt respects role, dismissal, and resumed-draft state", () => {
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, role: "mechanic" }), false);
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, draftPromptDismissed: true }), false);
  assert.equal(shouldPromptForWorkorderDraft({ ...createScreen, resumedDraftId: "draft-1" }), false);
});
