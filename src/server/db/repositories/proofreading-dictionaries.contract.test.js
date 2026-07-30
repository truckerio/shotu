import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/040_proofreading_dictionaries.sql", import.meta.url),
  "utf8",
);
const repository = readFileSync(new URL("./proofreading-dictionaries.repo.js", import.meta.url), "utf8");

test("migration creates tenant-scoped soft-deleted terms and append-only audit events", () => {
  assert.match(migration, /create table proofreading_dictionary_terms/i);
  assert.match(migration, /company_id uuid not null references companies\(id\)/i);
  assert.match(migration, /owner_user_id uuid references user_profiles\(id\) on delete restrict/i);
  assert.match(migration, /references user_company_memberships\(user_id, company_id\)[\s\S]*on delete restrict/i);
  assert.match(migration, /where active;/i);
  assert.match(migration, /coalesce\(owner_user_id,[\s\S]*normalized_term/i);
  assert.match(migration, /char_length\(display_term\) between 2 and 64/i);
  assert.match(migration, /display_term ~ '[^']*\[\[:alpha:\]\]/i);
  assert.match(migration, /create table proofreading_dictionary_events/i);
  assert.match(migration, /action text not null check \(action in \('add', 'remove'\)\)/i);
});

test("repository lists only the company and actor active union with a hard limit", () => {
  assert.match(repository, /where term\.company_id = \$1[\s\S]*term\.active/i);
  assert.match(repository, /term\.owner_user_id is null or term\.owner_user_id = \$2/i);
  assert.match(repository, /distinct on \(term\.normalized_term\)/i);
  assert.match(repository, /limit \$3/i);
  assert.match(repository, /Math\.min\(parsed, fallback\)/);
});

test("repository reactivates and soft deletes terms in audited transactions", () => {
  assert.match(repository, /client\.query\("begin"\)/);
  assert.match(repository, /client\.query\("commit"\)/);
  assert.match(repository, /client\.query\("rollback"\)/);
  assert.match(repository, /owner_user_id is not distinct from \$2::uuid/i);
  assert.match(repository, /set display_term = \$2,[\s\S]*active = true[\s\S]*removed_at = null/i);
  assert.match(repository, /set active = false,[\s\S]*removed_at = now\(\)/i);
  assert.match(repository, /values \(\$1, \$2, \$3, \$4, 'add'/i);
  assert.match(repository, /values \(\$1, \$2, \$3, \$4, 'remove'/i);
});
