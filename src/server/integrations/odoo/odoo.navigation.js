function numericId(value) {
  const text = String(value || "").trim();
  return /^[1-9][0-9]*$/.test(text) ? text : "";
}

function serviceFlagIsTrue(expression, field) {
  const normalized = String(expression || "")
    .toLowerCase()
    .replaceAll('"', "'")
    .replace(/\s+/g, "");
  return normalized.includes(`'${String(field || "is_service_order").toLowerCase()}','=',true`);
}

function defaultServiceFlagIsTrue(expression, field) {
  const normalized = String(expression || "")
    .toLowerCase()
    .replaceAll('"', "'")
    .replace(/\s+/g, "");
  return normalized.includes(`'default_${String(field || "is_service_order").toLowerCase()}':true`);
}

function hasFormView(action) {
  return Array.isArray(action?.views)
    ? action.views.some((view) => Array.isArray(view) && view[1] === "form")
    : String(action?.view_mode || "").split(",").includes("form");
}

export function selectOdooServiceOrderAction(actions, {
  orderModel = "sale.order",
  serviceFlagField = "is_service_order",
} = {}) {
  const candidates = (Array.isArray(actions) ? actions : []).filter((action) => (
    String(action?.res_model || "") === orderModel
    && hasFormView(action)
    && (
      serviceFlagIsTrue(action.domain, serviceFlagField)
      || defaultServiceFlagIsTrue(action.context, serviceFlagField)
    )
    && numericId(action.id)
  ));
  candidates.sort((left, right) => {
    const leftNamed = /^service orders?$/i.test(String(left.name || "").trim()) ? 0 : 1;
    const rightNamed = /^service orders?$/i.test(String(right.name || "").trim()) ? 0 : 1;
    return leftNamed - rightNamed || Number(left.id) - Number(right.id);
  });
  return numericId(candidates[0]?.id);
}

export function publicOdooRecordUrl({
  baseUrl,
  externalId,
  model = "sale.order",
  actionId = "",
} = {}) {
  if (!baseUrl || !numericId(externalId)) return "";
  const action = numericId(actionId);
  if ((model || "sale.order") === "sale.order" && !action) return "";
  try {
    const url = new URL(String(baseUrl));
    const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHost) return "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/web`;
    url.search = "";
    url.hash = [
      ...(action ? [`action=${action}`] : []),
      `id=${externalId}`,
      `model=${encodeURIComponent(model || "sale.order")}`,
      "view_type=form",
    ].join("&");
    return url.toString();
  } catch {
    return "";
  }
}
