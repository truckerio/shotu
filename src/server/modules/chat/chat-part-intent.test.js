import assert from "node:assert/strict";
import test from "node:test";
import { classifyMechanicPartIntent } from "./chat-part-intent.js";

test("detects explicit and conversational part requests", () => {
  const vagueRequest = classifyMechanicPartIntent({ body: "I need a fuel pump" });
  assert.equal(vagueRequest.intent, "part_request");
  assert.equal(vagueRequest.shouldIdentify, false);
  assert.equal(vagueRequest.partDescription, "fuel pump");
  assert.equal(classifyMechanicPartIntent({ body: "Please order the air filter" }).intent, "part_request");
  assert.equal(classifyMechanicPartIntent({ body: "Replace the NOx sensor" }).intent, "part_request");
});

test("detects bare part descriptions and part numbers", () => {
  assert.equal(classifyMechanicPartIntent({ body: "fuel pump" }).reason, "bare_part_phrase");
  assert.equal(classifyMechanicPartIntent({ body: "Please order the air filter" }).partDescription, "air filter");
  assert.equal(classifyMechanicPartIntent({ body: "Replace the NOx sensor" }).partDescription, "NOx sensor");
  const numbered = classifyMechanicPartIntent({ body: "A4721800309" });
  assert.equal(numbered.intent, "part_request");
  assert.equal(numbered.partNumber, "A4721800309");
});

test("treats a photo without part language as an AI candidate", () => {
  const result = classifyMechanicPartIntent({ body: "What is this?", hasAttachment: true });
  assert.equal(result.intent, "part_candidate");
  assert.equal(result.shouldIdentify, true);
});

test("leaves ordinary mechanic updates as normal chat", () => {
  assert.equal(classifyMechanicPartIntent({ body: "Truck is ready for a road test" }).intent, "normal");
  assert.equal(classifyMechanicPartIntent({ body: "I found an air leak behind the cab" }).intent, "normal");
  assert.equal(classifyMechanicPartIntent({ body: "Handoff received. Installing the approved filter." }).intent, "normal");
  assert.equal(classifyMechanicPartIntent({ body: "Installed fuel filter" }).intent, "normal");
});
