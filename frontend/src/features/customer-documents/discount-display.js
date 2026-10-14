export function discountDisplay(discount, projection) {
  if (!discount || discount.value === "" || discount.value == null) return "—";
  const value = Number(discount.value);
  if (!Number.isFinite(value) || value < 0) return "—";
  const money = (amount) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: projection?.currency || "USD",
    minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount);
  if (discount.kind === "fixed") return money(value);
  const amount = projection?.financialFingerprint && projection.discount != null
    && Number.isFinite(Number(projection.discount)) ? money(Number(projection.discount)) : "—";
  return `${value}% · ${amount}`;
}
