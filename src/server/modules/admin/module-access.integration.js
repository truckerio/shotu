import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { closePool, query } from "../../db/pool.js";
import {
  getCompanyWorkorderModulePolicy,
  getEffectiveWorkorderModulePolicy,
  getLocationWorkorderPolicy,
  saveCompanyWorkorderModulePolicy,
  saveLocationWorkorderPolicy,
} from "../../db/repositories/workorder-policies.repo.js";
import { resolveEffectiveWorkorderModuleAccess } from "../../../../shared/workorder-modules.js";
import {
  getNormalizedModulePolicy,
  saveNormalizedModulePolicy,
} from "../../db/repositories/module-access-rules.repo.js";

const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
let companyId;
let locationId;
let actorId;
let otherCompanyId;

let companyUserId;
let locationUserId;

try {
  const actor = await query(
    `insert into user_profiles (display_name, contact_email)
     values ($1, $2)
     returning id`,
    ["Module Policy Integration Admin", `module-policy-${suffix}@example.test`],
  );
  actorId = actor.rows[0].id;
  const subjects = await query(
    `insert into user_profiles (display_name, contact_email)
     values ($1, $2), ($3, $4)
     returning id`,
    [
      "Company Policy User", `company-policy-${suffix}@example.test`,
      "Location Policy User", `location-policy-${suffix}@example.test`,
    ],
  );
  [companyUserId, locationUserId] = subjects.rows.map(({ id }) => id);

  const company = await query(
    `insert into companies (slug, name)
     values ($1, $2)
     returning id`,
    [`module-policy-${suffix}`, `Module Policy ${suffix}`],
  );
  companyId = company.rows[0].id;
  const otherCompany = await query(
    `insert into companies (slug, name) values ($1, $2) returning id`,
    [`module-policy-other-${suffix}`, `Other Module Policy ${suffix}`],
  );
  otherCompanyId = otherCompany.rows[0].id;
  await query(
    `insert into user_company_memberships (user_id, company_id, role, active)
     values ($1, $3, 'office', true), ($2, $3, 'mechanic', true)`,
    [companyUserId, locationUserId, companyId],
  );

  const location = await query(
    `insert into locations (company_id, name, type)
     values ($1, $2, 'yard')
     returning id`,
    [companyId, `Module Policy Yard ${suffix}`],
  );
  locationId = location.rows[0].id;
  await assert.rejects(query(
    `insert into workorder_module_policy_scopes (scope_type, company_id, location_id)
     values ('location', $1, $2)`,
    [otherCompanyId, locationId],
  ), (error) => error.code === "23503");
  const outsideUser = await query(
    `insert into user_profiles (display_name, contact_email) values ($1, $2) returning id`,
    ["Outside Policy User", `outside-policy-${suffix}@example.test`],
  );
  await query(
    `insert into user_company_memberships (user_id, company_id, role, active)
     values ($1, $2, 'office', true)`,
    [outsideUser.rows[0].id, otherCompanyId],
  );
  await assert.rejects(saveNormalizedModulePolicy({
    companyId,
    actorId,
    expectedVersion: 0,
    moduleAccess: {},
    userModuleAccess: { [outsideUser.rows[0].id]: { detail: { odoo: "read" } } },
  }), (error) => error.statusCode === 400);
  await query("delete from user_profiles where id = $1", [outsideUser.rows[0].id]);

  const companyPolicy = await saveCompanyWorkorderModulePolicy({
    companyId,
    actorId,
    expectedVersion: 0,
    moduleAccess: {
      office: { detail: { odoo: "read" } },
      mechanic: { detail: { odoo: "hidden" } },
    },
    userModuleAccess: {
      [companyUserId]: { detail: { odoo: "write" } },
      [locationUserId]: { detail: { odoo: "write" } },
    },
  });
  assert.equal(companyPolicy.version, 1);
  assert.equal(companyPolicy.moduleAccess.office.detail.odoo, "read");
  assert.equal(companyPolicy.userModuleAccess[companyUserId].detail.odoo, "write");

  const normalizedCompanyPolicy = await getNormalizedModulePolicy({ companyId });
  assert.deepEqual(normalizedCompanyPolicy.moduleAccess, companyPolicy.moduleAccess);
  assert.deepEqual(normalizedCompanyPolicy.userModuleAccess, companyPolicy.userModuleAccess);

  const persistedCompanyPolicy = await getCompanyWorkorderModulePolicy(companyId);
  assert.deepEqual(persistedCompanyPolicy.moduleAccess, companyPolicy.moduleAccess);
  assert.deepEqual(persistedCompanyPolicy.userModuleAccess, companyPolicy.userModuleAccess);
  assert.equal(persistedCompanyPolicy.version, 1);

  await assert.rejects(
    saveCompanyWorkorderModulePolicy({
      companyId,
      actorId,
      expectedVersion: 0,
      moduleAccess: {},
      userModuleAccess: {},
    }),
    (error) => error.statusCode === 409 && error.code === "WORKORDER_MODULE_POLICY_CONFLICT",
  );

  const locationPolicy = await saveLocationWorkorderPolicy({
    locationId,
    companyId,
    actorId,
    mechanicCanRecordParts: false,
    moduleAccess: {
      office: { detail: { odoo: "hidden" } },
      mechanic: { detail: { odoo: "hidden" } },
    },
    userModuleAccess: {
      [locationUserId]: { detail: { odoo: "read" } },
    },
    expectedVersion: 0,
  });
  assert.equal(locationPolicy.version, 1);
  await assert.rejects(saveLocationWorkorderPolicy({
    locationId,
    companyId,
    actorId,
    mechanicCanRecordParts: false,
    moduleAccess: {},
    userModuleAccess: {},
    expectedVersion: 0,
  }), (error) => error.statusCode === 409 && error.code === "WORKORDER_MODULE_POLICY_CONFLICT");

  const normalizedLocationPolicy = await getNormalizedModulePolicy({ companyId, locationId });
  assert.equal(normalizedLocationPolicy.moduleAccess.office.detail.odoo, "hidden");
  assert.equal(normalizedLocationPolicy.userModuleAccess[locationUserId].detail.odoo, "read");

  const persistedLocationPolicy = await getLocationWorkorderPolicy(locationId, [companyId]);
  assert.equal(persistedLocationPolicy.moduleAccessOverrides.office.detail.odoo, "hidden");
  assert.equal(persistedLocationPolicy.userModuleAccess[locationUserId].detail.odoo, "read");

  const effective = await getEffectiveWorkorderModulePolicy({ companyId, locationId });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    role: "office",
    surface: "detail",
    moduleKey: "odoo",
    ...effective,
  }), { access: "hidden", source: "location" });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    role: "mechanic",
    surface: "detail",
    moduleKey: "odoo",
    userId: companyUserId,
    ...effective,
  }), { access: "write", source: "company_user" });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    role: "mechanic",
    surface: "detail",
    moduleKey: "odoo",
    userId: locationUserId,
    ...effective,
  }), { access: "read", source: "user" });

  await query("delete from user_profiles where id = $1", [companyUserId]);
  const userRuleCleanup = await query(
    "select count(*)::int as count from workorder_module_access_rules where user_id = $1",
    [companyUserId],
  );
  assert.equal(userRuleCleanup.rows[0].count, 0);
  const effectiveAfterDelete = await getEffectiveWorkorderModulePolicy({ companyId, locationId });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    role: "mechanic",
    surface: "detail",
    moduleKey: "odoo",
    userId: companyUserId,
    ...effectiveAfterDelete,
  }), { access: "hidden", source: "location" });

  console.log(JSON.stringify({
    passed: true,
    companyRolePersistence: true,
    companyUserPersistence: true,
    optimisticConflict: true,
    locationPrecedence: true,
    locationOptimisticConflict: true,
    normalizedRulePersistence: true,
    normalizedOnlyPersistence: true,
    userRuleCleanup: true,
    crossCompanyLocationRejected: true,
    crossCompanyUserRejected: true,
  }));
} finally {
  if (locationId) await query("delete from locations where id = $1", [locationId]);
  if (companyId) await query("delete from companies where id = $1", [companyId]);
  if (otherCompanyId) await query("delete from companies where id = $1", [otherCompanyId]);
  if (actorId) await query("delete from user_profiles where id = $1", [actorId]);
  if (companyUserId) await query("delete from user_profiles where id = $1", [companyUserId]);
  if (locationUserId) await query("delete from user_profiles where id = $1", [locationUserId]);
  if (companyId) {
    const companyCleanup = await query("select count(*)::int as count from companies where id = $1", [companyId]);
    assert.equal(companyCleanup.rows[0].count, 0);
  }
  if (actorId) {
    const actorCleanup = await query("select count(*)::int as count from user_profiles where id = $1", [actorId]);
    assert.equal(actorCleanup.rows[0].count, 0);
  }
  await closePool();
}
