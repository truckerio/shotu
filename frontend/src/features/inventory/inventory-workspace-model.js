export const DEFAULT_STOCK_SORT = "available_desc";

export const STOCK_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "reserved", label: "Fully reserved" },
  { value: "out", label: "Out of stock" },
];

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function stockState(item) {
  if (numeric(item?.quantityAvailable) > 0) return "available";
  if (numeric(item?.quantityOnHand) > 0) return "reserved";
  return "out";
}

export function stockStateLabel(state) {
  return {
    available: "Available",
    reserved: "Fully reserved",
    out: "Out of stock",
  }[state] || "Stock unknown";
}

export function stockFilterCounts(items = []) {
  return items.reduce((counts, item) => {
    counts.all += 1;
    counts[stockState(item)] += 1;
    return counts;
  }, { all: 0, available: 0, reserved: 0, out: 0 });
}

export function filterAndSortStock(items = [], { filter = "all", sort = DEFAULT_STOCK_SORT } = {}) {
  const filtered = filter === "all" ? [...items] : items.filter((item) => stockState(item) === filter);
  return filtered.sort((left, right) => {
    if (sort === "part_asc") {
      return String(left.partNumber || "").localeCompare(String(right.partNumber || ""), undefined, { numeric: true, sensitivity: "base" });
    }
    if (sort === "reserved_desc") {
      return numeric(right.quantityReserved) - numeric(left.quantityReserved)
        || numeric(right.quantityAvailable) - numeric(left.quantityAvailable);
    }
    if (sort === "locations_desc") {
      return numeric(right.locationCount) - numeric(left.locationCount)
        || numeric(right.quantityAvailable) - numeric(left.quantityAvailable);
    }
    return numeric(right.quantityAvailable) - numeric(left.quantityAvailable)
      || String(left.partNumber || "").localeCompare(String(right.partNumber || ""), undefined, { numeric: true, sensitivity: "base" });
  });
}
