import assert from "node:assert/strict";
import test from "node:test";
import { buildQaAccountManifest, normalizeQaNamespace, publicAccountView } from "./account-manifest.js";
import { parseArguments } from "./manage-qa-accounts.js";
import {
  assertQaTargetSafety,
  QA_PRODUCTION_CONFIRMATION,
  redactQaError,
} from "./safety.js";

test("QA identities are deterministic, complete, and unique", () => {
  const first = buildQaAccountManifest("release-7");
  const second = buildQaAccountManifest("release-7");
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((account) => account.role), ["admin", "office", "mechanic", "surveillance"]);
  assert.equal(new Set(first.map((account) => account.email)).size, 4);
  assert.equal(new Set(first.map((account) => account.username)).size, 4);
  assert.equal(first[0].email, "release-7.admin@qa.invalid");
  assert.equal(first[2].username, "release_7.mechanic");
});

test("QA namespaces reject ambiguous or unsafe identity characters", () => {
  assert.equal(normalizeQaNamespace(" QA-7 "), "qa-7");
  assert.throws(() => normalizeQaNamespace("qa team"));
  assert.throws(() => normalizeQaNamespace("qa@example.com"));
  assert.throws(() => normalizeQaNamespace(""));
});

test("public account output cannot expose a supplied password", () => {
  const account = { ...buildQaAccountManifest()[0], password: "NeverPrintThis1!" };
  const serialized = JSON.stringify(publicAccountView(account));
  assert.doesNotMatch(serialized, /NeverPrintThis1!/);
  assert.doesNotMatch(serialized, /password/i);
  assert.equal(redactQaError(new Error("failed NeverPrintThis1!"), [account.password]), "failed [REDACTED]");
});

test("target safety requires an explicit local or staging declaration", () => {
  assert.throws(() => assertQaTargetSafety({ environment: {}, options: {} }));
  assert.equal(assertQaTargetSafety({
    environment: { DATABASE_URL: "postgres://localhost/workorders" },
    options: { target: "local" },
  }).target, "local");
});

test("production indicators cannot be mislabeled as staging", () => {
  assert.throws(() => assertQaTargetSafety({
    environment: { NODE_ENV: "production" },
    options: { target: "staging" },
  }), /appears to be production/);
});

test("production requires every independent confirmation", () => {
  const environment = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:secret@prod-db.example.com/workorders",
    QA_PRODUCTION_CONFIRMATION: QA_PRODUCTION_CONFIRMATION.environment,
  };
  const base = {
    target: "production",
    allowProduction: true,
    productionConfirmation: QA_PRODUCTION_CONFIRMATION.argument,
    confirmDatabaseHost: "prod-db.example.com",
  };
  for (const key of ["allowProduction", "productionConfirmation", "confirmDatabaseHost"]) {
    assert.throws(() => assertQaTargetSafety({ environment, options: { ...base, [key]: undefined } }));
  }
  assert.throws(() => assertQaTargetSafety({
    environment: { ...environment, QA_PRODUCTION_CONFIRMATION: "wrong" },
    options: base,
  }));
  assert.equal(assertQaTargetSafety({ environment, options: base }).production, true);
});

test("CLI accepts values without allowing positional ambiguity", () => {
  assert.deepEqual(parseArguments([
    "apply",
    "--target=staging",
    "--company=default",
    "--location=Chino Yard",
  ]), {
    action: "apply",
    values: { target: "staging", company: "default", location: "Chino Yard" },
  });
  assert.throws(() => parseArguments(["apply", "unexpected"]));
});
