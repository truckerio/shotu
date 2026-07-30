import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROOFREADING_DICTIONARY_TERMS,
  addCompanyProofreadingTerm,
  addPersonalProofreadingTerm,
  listProofreadingDictionary,
  normalizeProofreadingDictionaryTerm,
  removeCompanyProofreadingTerm,
  removePersonalProofreadingTerm,
} from "./proofreading-dictionaries.service.js";

const COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const OTHER_COMPANY_ID = "20000000-0000-0000-0000-000000000002";
const USER_ID = "30000000-0000-0000-0000-000000000003";

function context(role = "mechanic") {
  return {
    actor: { id: USER_ID, role },
    companyIds: new Set([COMPANY_ID]),
  };
}

function row(overrides = {}) {
  return {
    id: "40000000-0000-0000-0000-000000000004",
    company_id: COMPANY_ID,
    owner_user_id: USER_ID,
    display_term: "Power Service",
    normalized_term: "power service",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

test("dictionary terms normalize case and punctuation but reject identifiers", () => {
  assert.deepEqual(normalizeProofreadingDictionaryTerm("  O’Reilly  "), {
    displayTerm: "O'Reilly",
    normalizedTerm: "o'reilly",
  });
  assert.deepEqual(normalizeProofreadingDictionaryTerm("Power   Service"), {
    displayTerm: "Power Service",
    normalizedTerm: "power service",
  });
  for (const invalid of ["A90801", "5W-30", "a", "word_thing", "x".repeat(65)]) {
    assert.throws(() => normalizeProofreadingDictionaryTerm(invalid), { code: "INVALID_REQUEST" });
  }
});

test("personal mutations always use the signed-in actor as owner", async () => {
  let saved;
  const added = await addPersonalProofreadingTerm(context(), {
    companyId: COMPANY_ID,
    term: "Freightliner",
    userId: "attacker-selected-user",
  }, {
    saveTerm: async (input) => {
      saved = input;
      return row({ display_term: "Freightliner", normalized_term: "freightliner" });
    },
  });
  assert.equal(saved.ownerUserId, USER_ID);
  assert.equal(saved.actorUserId, USER_ID);
  assert.equal(saved.companyId, COMPANY_ID);
  assert.equal(added.scope, "personal");

  let removed;
  await removePersonalProofreadingTerm(context(), { companyId: COMPANY_ID, term: "FREIGHTLINER" }, {
    removeTerm: async (input) => {
      removed = input;
      return row({ display_term: "Freightliner", normalized_term: "freightliner" });
    },
  });
  assert.equal(removed.ownerUserId, USER_ID);
  assert.equal(removed.normalizedTerm, "freightliner");
});

test("only admins may mutate company vocabulary", async () => {
  await assert.rejects(
    addCompanyProofreadingTerm(context("office"), { companyId: COMPANY_ID, term: "Bendix" }),
    { code: "PERMISSION_DENIED" },
  );
  await assert.rejects(
    removeCompanyProofreadingTerm(context("mechanic"), { companyId: COMPANY_ID, term: "Bendix" }),
    { code: "PERMISSION_DENIED" },
  );

  let saved;
  const added = await addCompanyProofreadingTerm(context("admin"), { companyId: COMPANY_ID, term: "Bendix" }, {
    saveTerm: async (input) => {
      saved = input;
      return row({ owner_user_id: null, display_term: "Bendix", normalized_term: "bendix" });
    },
  });
  assert.equal(saved.ownerUserId, null);
  assert.equal(added.scope, "company");
});

test("company selection is tenant checked for reads and writes", async () => {
  await assert.rejects(
    listProofreadingDictionary(context(), { companyId: OTHER_COMPANY_ID }, { listTerms: async () => [] }),
    { code: "PERMISSION_DENIED" },
  );
  await assert.rejects(
    addCompanyProofreadingTerm(context("admin"), { companyId: OTHER_COMPANY_ID, term: "Bendix" }),
    { code: "PERMISSION_DENIED" },
  );
});

test("list requests one bounded company and actor union", async () => {
  let received;
  const terms = await listProofreadingDictionary(context(), {}, {
    listTerms: async (input) => {
      received = input;
      return [
        row({ owner_user_id: null, display_term: "Bendix", normalized_term: "bendix" }),
        row(),
      ];
    },
  });
  assert.deepEqual(received, {
    companyId: COMPANY_ID,
    ownerUserId: USER_ID,
    limit: MAX_PROOFREADING_DICTIONARY_TERMS,
  });
  assert.deepEqual(terms.map(({ scope, term }) => ({ scope, term })), [
    { scope: "company", term: "Bendix" },
    { scope: "personal", term: "Power Service" },
  ]);
});

test("removing an absent term returns a bounded not-found error", async () => {
  await assert.rejects(
    removePersonalProofreadingTerm(context(), { term: "Bendix" }, { removeTerm: async () => null }),
    { code: "RESOURCE_NOT_FOUND" },
  );
});
