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

test("mechanic request action is permission-gated while used parts remain canonical", () => {
  assert.match(mechanicSurface, /mechanicPartsActionState\(detail\.allowedActions/);
  assert.match(mechanicSurface, /canRequestPart[\s\S]*parts\.requestPart/);
  assert.match(mechanicSurface, /<MechanicPartRequestForm/);
  assert.match(panel, /role === "office"/);
  assert.match(mechanicSurface, /<UsedPartsSection/);
  assert.doesNotMatch(mechanicSurface, /usedPartAction|needPartAction|activeAction/);
});

test("mechanic request action uses the shared locale owner", () => {
  assert.match(mechanicSurface, /interfaceText\(locale, key\)/);
  assert.match(mechanicSurface, /\{t\("parts\.requestPart"\)\}/);
});

test("mechanic request action uses an accessible inline disclosure", () => {
  assert.match(mechanicSurface, /type="button"/);
  assert.match(mechanicSurface, /aria-controls=\{requestPartPanelId\}/);
  assert.match(mechanicSurface, /aria-expanded=\{requestFormOpen\}/);
  assert.match(mechanicSurface, /hidden=\{!requestFormOpen\}/);
  assert.doesNotMatch(mechanicSurface, /aria-pressed/);
});

test("failed submission retains the draft and reports local field errors", () => {
  assert.match(form, /setDraft\(createMechanicPartRequestDraft\(\)\)/);
  assert.match(form, /catch \(error\)[\s\S]*setErrors/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /role="alert"/);
});
