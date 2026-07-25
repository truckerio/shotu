import assert from "node:assert/strict";
import test from "node:test";
import { reserveWorkorderSerials } from "../../db/repositories/serial-counters.repo.js";

test("serial reservations lock the company counter and skip existing workorder numbers", async () => {
  const updates = [];
  const client = {
    async query(sql, params) {
      if (/insert into workorder_serial_counters/i.test(sql)) return { rows: [] };
      if (/from workorder_serial_counters/i.test(sql)) {
        return { rows: [{ company_id: params[0], prefix: "WO-", next_number: 12, digits: 6 }] };
      }
      if (/from operational_workorders/i.test(sql)) {
        return { rows: params[1] === "WO-000012" ? [{ exists: 1 }] : [] };
      }
      if (/update workorder_serial_counters/i.test(sql)) {
        updates.push(params);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const reservation = await reserveWorkorderSerials({
    companyId: "00000000-0000-0000-0000-000000000001",
    count: 2,
  }, client);

  assert.deepEqual(reservation.serials, ["WO-000013", "WO-000014"]);
  assert.equal(reservation.nextNumber, 15);
  assert.deepEqual(updates, [["00000000-0000-0000-0000-000000000001", 15]]);
});
