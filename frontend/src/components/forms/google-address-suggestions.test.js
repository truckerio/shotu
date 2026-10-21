import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleAddressSession, loadGoogleAddressLibrary } from "./google-address-suggestions.js";

function provider() {
  const calls = [];
  const fields = [];
  const prediction = { text: { toString: () => "123 Main St" }, toPlace: () => ({ formattedAddress: "123 Main St, Chino, CA 91710", fetchFields: async (input) => fields.push(input) }) };
  return { calls, fields, prediction, library: { AutocompleteSessionToken: class Token {}, AutocompleteSuggestion: { fetchAutocompleteSuggestions: async (input) => { calls.push(input); return { suggestions: [{ placePrediction: prediction }, {}] }; } } } };
}

test("missing browser key never loads SDK or requests predictions", async () => {
  const result = await loadGoogleAddressLibrary("", { windowObject: {}, documentObject: { createElement: () => assert.fail("SDK must stay unloaded") } });
  assert.equal(result, null);
});

test("configured existing Google library loads Places New without another script", async () => {
  const fake = provider();
  const result = await loadGoogleAddressLibrary("fake-test-key", { windowObject: { google: { maps: { importLibrary: async (name) => { assert.equal(name, "places"); return fake.library; } } } }, documentObject: { createElement: () => assert.fail("Existing provider must be reused") } });
  assert.equal(result, fake.library);
});

test("prediction calls share a session until selection, then request formattedAddress only", async () => {
  const fake = provider();
  const session = createGoogleAddressSession(fake.library);
  const first = await session.predict("123");
  await session.predict("123 Main");
  assert.equal(fake.calls[0].sessionToken, fake.calls[1].sessionToken);
  assert.equal(first.length, 1);
  assert.equal(first[0].label, "123 Main St");
  assert.equal(await session.resolve(first[0]), "123 Main St, Chino, CA 91710");
  assert.deepEqual(fake.fields, [{ fields: ["formattedAddress"] }]);
  await session.predict("456");
  assert.notEqual(fake.calls[2].sessionToken, fake.calls[0].sessionToken);
  session.reset();
  await session.predict("789");
  assert.notEqual(fake.calls[3].sessionToken, fake.calls[2].sessionToken);
});

test("provider/detail failures do not replace manual text and next query uses a new session", async () => {
  const fake = provider();
  const session = createGoogleAddressSession(fake.library);
  await session.predict("123");
  await assert.rejects(session.resolve({ prediction: { toPlace: () => ({ fetchFields: async () => { throw new Error("Offline"); } }) } }), /Offline/);
  await session.predict("456");
  assert.notEqual(fake.calls[1].sessionToken, fake.calls[0].sessionToken);
});
