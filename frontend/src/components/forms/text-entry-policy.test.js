import assert from "node:assert/strict";
import test from "node:test";
import { textEntryProps } from "./text-entry-policy.js";

test("narrative fields retain native spellcheck as a platform fallback", () => {
  assert.deepEqual(textEntryProps("narrative"), {
    autoCorrect: "on",
    spellCheck: true,
    autoCapitalize: "sentences",
  });
});

test("person names capitalize words without rewriting uncommon names", () => {
  assert.deepEqual(textEntryProps("name"), {
    autoCorrect: "off",
    spellCheck: false,
    autoCapitalize: "words",
  });
});

test("identifiers disable correction, spellcheck, and capitalization", () => {
  assert.deepEqual(textEntryProps("identifier"), {
    autoCorrect: "off",
    spellCheck: false,
    autoCapitalize: "none",
  });
});

test("search and account fields disable correction, spellcheck, and capitalization", () => {
  assert.deepEqual(textEntryProps("search"), {
    autoCorrect: "off",
    spellCheck: false,
    autoCapitalize: "none",
  });
});

test("shared policies are immutable", () => {
  for (const kind of ["narrative", "name", "identifier", "search"]) {
    const policy = textEntryProps(kind);
    assert.equal(Object.isFrozen(policy), true);
  }
});

test("unknown policy kinds fail loudly", () => {
  assert.throws(() => textEntryProps("account"), /Unknown text-entry policy: account/);
});
