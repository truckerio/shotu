const clean = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export class UnsupportedTruckError extends Error {
  constructor(make, model) {
    super(`Parts helper currently supports Volvo, Peterbilt, and Freightliner Cascadia. Received: ${[make, model].filter(Boolean).join(" ") || "unknown truck"}.`);
    this.name = "UnsupportedTruckError";
    this.statusCode = 400;
  }
}

export function supportedTruckFamily(vehicle) {
  const make = clean(vehicle?.make);
  const model = clean(vehicle?.model);

  if (make.includes("volvo")) return "volvo";
  if (make.includes("peterbilt")) return "peterbilt";
  if ((make.includes("freightliner") && model.includes("cascadia")) || model === "cascadia") return "cascadia";
  return null;
}

export function requireSupportedTruck(vehicle) {
  const family = supportedTruckFamily(vehicle);
  if (!family) throw new UnsupportedTruckError(vehicle?.make, vehicle?.model);
  return family;
}

export const supportedTruckLabels = ["Volvo", "Peterbilt", "Freightliner Cascadia"];

