import assert from "node:assert/strict";
import test from "node:test";
import { commercialProfileInitialScope, commercialProfileSetupUrl } from "./commercial-profile-navigation.js";

const locations = [
  { id: "yard-a", company_id: "company-a", name: "Other shop" },
  { id: "chino", companyId: "company-b", name: "Chino shop" },
  { location: { id: "yard-b" }, companyId: "company-b" },
];

test("Workorder setup link selects its company and exact shop instead of the first company", () => {
  const url = new URL(commercialProfileSetupUrl("company-b", "chino"), "https://example.test");
  assert.deepEqual(commercialProfileInitialScope(locations, url.search), { companyId: "company-b", locationId: "chino" });
});

test("company-default links do not select a location", () => {
  const url = new URL(commercialProfileSetupUrl("company-b"), "https://example.test");
  assert.equal(url.searchParams.has("commercialLocation"), false);
  assert.deepEqual(commercialProfileInitialScope(locations, url.search), { companyId: "company-b", locationId: "" });
});

test("unknown companies, shops and cross-company shops never become selected scope", () => {
  assert.deepEqual(commercialProfileInitialScope(locations, "?commercialCompany=foreign&commercialLocation=chino"), { companyId: "company-a", locationId: "" });
  for (const location of ["unknown", "yard-a"]) {
    assert.deepEqual(commercialProfileInitialScope(locations, `?commercialCompany=company-b&commercialLocation=${location}`), { companyId: "company-b", locationId: "" });
  }
  assert.deepEqual(commercialProfileInitialScope([], "?commercialCompany=company-b&commercialLocation=chino"), { companyId: "", locationId: "" });
});

test("normal Settings entry retains company-default behavior and nested shop IDs work", () => {
  assert.deepEqual(commercialProfileInitialScope(locations), { companyId: "company-a", locationId: "" });
  assert.deepEqual(commercialProfileInitialScope(locations, "?commercialCompany=company-b&commercialLocation=yard-b"), { companyId: "company-b", locationId: "yard-b" });
});

test("scope is URL encoded rather than interpreted as extra query parameters", () => {
  const url = new URL(commercialProfileSetupUrl("company&adminView=other", "shop + /"), "https://example.test");
  assert.equal(url.searchParams.get("adminView"), "settings");
  assert.equal(url.searchParams.get("commercialCompany"), "company&adminView=other");
  assert.equal(url.searchParams.get("commercialLocation"), "shop + /");
});
