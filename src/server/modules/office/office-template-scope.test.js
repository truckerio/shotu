import assert from "node:assert/strict";
import test from "node:test";
import { getAuthorizedLocationTemplates } from "../../db/repositories/templates.repo.js";
import { loadOfficeLocationTemplates, officeTemplateScope } from "./office-template-scope.js";

const COMPANY_A = "10000000-0000-0000-0000-000000000001";
const COMPANY_B = "20000000-0000-0000-0000-000000000002";
const LOCATION_A = "11111111-1111-1111-1111-111111111111";
const LOCATION_B = "22222222-2222-2222-2222-222222222222";

function context(role, { companyIds = [], locationIds = [] } = {}) {
  return {
    actor: { id: `${role}-1`, role },
    companyIds: new Set(companyIds),
    locationIds: new Set(locationIds),
  };
}

test("admin template scope expands to every active location in authorized companies", async () => {
  const requestContext = context("admin", {
    companyIds: [COMPANY_A],
    locationIds: [],
  });
  let receivedScope;

  const rows = await loadOfficeLocationTemplates(requestContext, {
    listTemplates: async (scope) => {
      receivedScope = scope;
      return [{ location_id: LOCATION_A }];
    },
  });

  assert.deepEqual(receivedScope, { companyIds: [COMPANY_A], locationIds: null });
  assert.deepEqual(rows, [{ location_id: LOCATION_A }]);
});

test("office template scope remains restricted to explicit location memberships", async () => {
  const requestContext = context("office", {
    companyIds: [COMPANY_A],
    locationIds: [LOCATION_A],
  });
  let receivedScope;

  await loadOfficeLocationTemplates(requestContext, {
    listTemplates: async (scope) => {
      receivedScope = scope;
      return [];
    },
  });

  assert.deepEqual(receivedScope, { companyIds: [COMPANY_A], locationIds: [LOCATION_A] });
});

test("authorized template query excludes locations from inaccessible companies", async () => {
  let statement;
  let parameters;
  await getAuthorizedLocationTemplates(
    { companyIds: [COMPANY_A], locationIds: [LOCATION_A, LOCATION_B] },
    async (sql, values) => {
      statement = sql;
      parameters = values;
      return { rows: [] };
    },
  );

  assert.match(statement, /location\.company_id = any\(\$1::uuid\[\]\)/);
  assert.match(statement, /location\.id = any\(\$2::uuid\[\]\)/);
  assert.match(statement, /location\.active = true/);
  assert.match(statement, /template\.active = true/);
  assert.deepEqual(parameters, [[COMPANY_A], [LOCATION_A, LOCATION_B]]);
  assert.equal(parameters[0].includes(COMPANY_B), false);
});

test("empty company or office location scope returns no rows without querying", async () => {
  let calls = 0;
  const listTemplates = async () => {
    calls += 1;
    return [];
  };

  assert.equal(officeTemplateScope(context("admin")), null);
  assert.equal(officeTemplateScope(context("office", { companyIds: [COMPANY_A] })), null);
  assert.deepEqual(await loadOfficeLocationTemplates(context("admin"), { listTemplates }), []);
  assert.deepEqual(await loadOfficeLocationTemplates(
    context("office", { companyIds: [COMPANY_A] }),
    { listTemplates },
  ), []);
  assert.equal(calls, 0);
});
