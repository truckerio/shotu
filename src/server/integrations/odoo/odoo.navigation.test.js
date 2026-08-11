import assert from "node:assert/strict";
import test from "node:test";
import {
  publicOdooRecordUrl,
  selectOdooServiceOrderAction,
} from "./odoo.navigation.js";

test("service-order navigation chooses the action whose domain owns service orders", () => {
  const actionId = selectOdooServiceOrderAction([
    {
      id: 398,
      name: "Quotations",
      res_model: "sale.order",
      view_mode: "list,form",
      domain: "[('is_service_order', '=', False)]",
    },
    {
      id: 941,
      name: "Service Orders",
      res_model: "sale.order",
      view_mode: "list,form",
      views: [[3595, "list"], [3594, "form"]],
      domain: "[('is_service_order', '=', True)]",
      context: "{'default_is_service_order': True}",
    },
  ]);
  assert.equal(actionId, "941");
});

test("service-order record links carry the discovered action and reject unsafe URLs", () => {
  assert.equal(
    publicOdooRecordUrl({
      baseUrl: "https://protec.example.odoo.com",
      externalId: "14397",
      model: "sale.order",
      actionId: "941",
    }),
    "https://protec.example.odoo.com/web#action=941&id=14397&model=sale.order&view_type=form",
  );
  assert.equal(publicOdooRecordUrl({
    baseUrl: "https://protec.example.odoo.com",
    externalId: "14397",
    model: "sale.order",
  }), "");
  assert.equal(publicOdooRecordUrl({ baseUrl: "http://unsafe.example.com", externalId: "14397" }), "");
  assert.equal(publicOdooRecordUrl({ baseUrl: "https://safe.example.com", externalId: "not-an-id" }), "");
});
