import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workorderPreferencesSchema } from "./workorder-preferences.schemas.js";
import { presentWorkorderPreferences } from "./workorder-preferences.service.js";

test("workorder preferences accept role-specific saved filters", () => {
  const result = workorderPreferencesSchema.parse({
    defaultLocationId: null,
    defaultView: "needs_attention",
    pageSize: 50,
    savedFilters: {
      admin: { category: "needs_attention", sort: "timeInStatus:desc" },
      mechanic: { activeTab: "myWork" },
    },
  });
  assert.equal(result.defaultView, "needs_attention");
  assert.equal(result.savedFilters.mechanic.activeTab, "myWork");
});

test("workorder preferences enforce bounded page size", () => {
  assert.throws(() => workorderPreferencesSchema.parse({ pageSize: 500 }));
});

test("workorder preferences accept supported locales and reject invalid locales", () => {
  assert.deepEqual(workorderPreferencesSchema.parse({ locale: "pa" }), { locale: "pa" });
  assert.deepEqual(workorderPreferencesSchema.parse({ locale: "es" }), { locale: "es" });
  assert.throws(() => workorderPreferencesSchema.parse({ locale: "fr" }));
});

test("preference presentation defaults locale to English", () => {
  assert.equal(presentWorkorderPreferences(null).locale, "en");
  assert.equal(presentWorkorderPreferences({ locale: "pa" }).locale, "pa");
});

test("locale-only preference updates preserve omitted fields atomically", async () => {
  const repository = await readFile(
    new URL("../../db/repositories/workorder-attention.repo.js", import.meta.url),
    "utf8",
  );

  assert.match(repository, /locale = case when \$11 then excluded\.locale else user_workorder_preferences\.locale end/);
  assert.match(repository, /default_view = case when \$8 then excluded\.default_view else user_workorder_preferences\.default_view end/);
  assert.match(repository, /saved_filters = case when \$10 then excluded\.saved_filters else user_workorder_preferences\.saved_filters end/);
});

test("the authenticated actor owns every preference read and write", async () => {
  const service = await readFile(
    new URL("./workorder-preferences.service.js", import.meta.url),
    "utf8",
  );

  assert.equal((service.match(/requireActor\(context\)/g) || []).length, 2);
  assert.match(service, /getWorkorderPreferences\(actor\.id\)/);
  assert.match(service, /saveWorkorderPreferences\(actor\.id, input\)/);
});

test("locale preference migration is additive and constrained", async () => {
  const sql = await readFile(
    new URL("../../db/migrations/041_workorder_preference_locale.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /add column if not exists locale text not null default 'en'/);
  assert.match(sql, /check \(locale in \('en', 'pa', 'es'\)\)/);
});
