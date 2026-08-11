export function vehicleMileage(vehicle) {
  if (vehicle?.last_odometer_miles) return String(Math.round(Number(vehicle.last_odometer_miles)));
  if (vehicle?.last_odometer_meters) return String(Math.round(Number(vehicle.last_odometer_meters) / 1609.344));
  return "";
}

export function vehicleModelText(vehicle = {}) {
  const seen = new Set();
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .filter((value) => {
      const key = String(value).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

export function vehicleCompanyId(vehicle = {}) {
  return String(vehicle.company_id || vehicle.companyId || "").trim();
}

export function vehicleBelongsToCompany(vehicle, companyId) {
  const expectedCompanyId = String(companyId || "").trim();
  return !expectedCompanyId || vehicleCompanyId(vehicle) === expectedCompanyId;
}

export function vehiclesForCompany(vehicles = [], companyId = "") {
  return vehicles.filter((vehicle) => vehicleBelongsToCompany(vehicle, companyId));
}
