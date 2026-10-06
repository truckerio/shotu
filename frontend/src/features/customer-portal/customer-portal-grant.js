export function customerPortalGrantFromLocation(location = window.location) {
  const fragment = String(location?.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  return params.get("customerDocument") || params.get("grant") || "";
}

export function customerPortalRequestHeaders(grant) {
  const token = String(grant || "").trim();
  if (!token) throw new Error("This customer link is unavailable.");
  return { "x-customer-grant": token };
}
