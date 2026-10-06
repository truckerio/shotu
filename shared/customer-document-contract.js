export const CUSTOMER_DOCUMENT_TYPE = Object.freeze({
  ESTIMATE: "estimate",
  INVOICE: "invoice",
});

export const CUSTOMER_DOCUMENT_RESPONSE = Object.freeze({
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CHANGES_REQUESTED: "changes_requested",
});

export const CUSTOMER_DOCUMENT_LINE_TYPE = Object.freeze({
  LABOR: "labor",
  PART: "part",
  SHOP_SUPPLY: "shop_supply",
  FEE: "fee",
  CORE_CHARGE: "core_charge",
  CREDIT: "credit",
});

export const CUSTOMER_DOCUMENT_PRICE_BASIS = Object.freeze({
  SELLING_PRICE: "selling_price",
  CUSTOMER_OVERRIDE: "customer_override",
});

export const CUSTOMER_DOCUMENT_GRANT_CAPABILITY = Object.freeze({
  VIEW_REVISION: "view_revision",
  RESPOND_REVISION: "respond_revision",
  CUSTOMER_CHAT: "customer_chat",
});

export const CUSTOMER_DOCUMENT_SCHEMA_VERSION = 1;

export const WORKORDER_ACTIVATION_POLICY = Object.freeze({
  ACCEPTED_CUSTOMER_ESTIMATE: "accepted_customer_estimate_v1",
  APPROVAL_NOT_REQUIRED: "approval_not_required_v1",
  LEGACY_INTERNAL_FLEET_DIRECT: "legacy_internal_fleet_direct_v1",
});

export const CUSTOMER_DOCUMENT_TYPES = Object.freeze(Object.values(CUSTOMER_DOCUMENT_TYPE));
export const CUSTOMER_DOCUMENT_RESPONSES = Object.freeze(Object.values(CUSTOMER_DOCUMENT_RESPONSE));
export const CUSTOMER_DOCUMENT_LINE_TYPES = Object.freeze(Object.values(CUSTOMER_DOCUMENT_LINE_TYPE));
export const CUSTOMER_DOCUMENT_PRICE_BASES = Object.freeze(Object.values(CUSTOMER_DOCUMENT_PRICE_BASIS));
export const CUSTOMER_DOCUMENT_GRANT_CAPABILITIES = Object.freeze(Object.values(CUSTOMER_DOCUMENT_GRANT_CAPABILITY));
