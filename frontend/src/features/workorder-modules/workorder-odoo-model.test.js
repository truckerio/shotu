import assert from "node:assert/strict";
import test from "node:test";
import { odooServiceOrderRecordUrl } from "./odoo/workorder-odoo-model.js";

test("created Odoo links open through the discovered service-order action", () => {
  assert.equal(
    odooServiceOrderRecordUrl(
      "https://protec.example.odoo.com/web#id=14397&model=sale.order&view_type=form",
      "941",
    ),
    "https://protec.example.odoo.com/web#id=14397&model=sale.order&view_type=form&action=941",
  );
  assert.equal(odooServiceOrderRecordUrl("https://protec.example.odoo.com/web#id=14397", ""),
    "https://protec.example.odoo.com/web#id=14397");
});
