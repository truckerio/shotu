import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync(new URL("./MechanicPartRequestForm.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./PartRequestsPanel.jsx", import.meta.url), "utf8");
const mechanicSurface = readFileSync(new URL("./part-requests/MechanicPartsSurface.jsx", import.meta.url), "utf8");

test("mechanic part form posts to the existing authorized endpoint and reloads detail", () => {
  assert.match(form, /`\/api\/mechanic\/workorders\/\$\{workorderId\}\/parts`/);
  assert.match(form, /await onChanged\(\)/);
  assert.doesNotMatch(form, /actorId|mechanicUserId/);
});

test("mechanic form is permission-gated without changing office composition", () => {
  assert.match(mechanicSurface, /mechanicPartsActionState\(detail\.allowedActions/);
  assert.match(mechanicSurface, /canRecordUsedPart[\s\S]*parts\.usedPartAction/);
  assert.match(mechanicSurface, /canRequestPart[\s\S]*parts\.needPartAction/);
  assert.match(mechanicSurface, /<MechanicPartRequestForm/);
  assert.match(panel, /role === "office"/);
  assert.match(mechanicSurface, /<UsedPartsSection/);
});

test("mechanic choices use the shared locale owner", () => {
  assert.match(mechanicSurface, /interfaceText\(locale, key\)/);
  assert.match(mechanicSurface, /aria-label=\{t\("parts\.chooseAction"\)\}/);
});

test("mechanic choice uses keyboard buttons and keeps inactive workflows mounted", () => {
  assert.match(mechanicSurface, /type="button"/);
  assert.match(mechanicSurface, /aria-pressed=/);
  assert.match(mechanicSurface, /hidden=\{mechanicActions\.canRecordUsedPart && activeAction !== "used"\}/);
  assert.match(mechanicSurface, /hidden=\{activeAction !== "request"\}/);
});

test("failed submission retains the draft and reports local field errors", () => {
  assert.match(form, /setDraft\(createMechanicPartRequestDraft\(\)\)/);
  assert.match(form, /catch \(error\)[\s\S]*setErrors/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /role="alert"/);
});
