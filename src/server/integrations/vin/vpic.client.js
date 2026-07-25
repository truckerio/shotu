function normalizeVin(value) {
  const match = String(value || "").toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
  return match?.[0] || "";
}

export async function decodeVinValuesBatch(vins) {
  const normalized = [...new Set(vins.map(normalizeVin).filter(Boolean))];
  const decoded = new Map();
  for (let index = 0; index < normalized.length; index += 50) {
    const chunk = normalized.slice(index, index + 50);
    const response = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ format: "json", data: chunk.join(";") }),
    });
    if (!response.ok) continue;
    const body = await response.json();
    for (const row of body.Results || []) {
      const vin = normalizeVin(row.VIN);
      if (!vin || row.ErrorCode !== "0") continue;
      decoded.set(vin, {
        vin,
        make: row.Make || "",
        model: row.Model || "",
        year: Number.isFinite(Number(row.ModelYear)) ? Number(row.ModelYear) : null,
        vehicleType: row.VehicleType || "",
        manufacturer: row.Manufacturer || "",
        bodyClass: row.BodyClass || "",
      });
    }
  }
  return decoded;
}

export function applyVinDecodes(assets, decodedByVin) {
  return assets.map((asset) => {
    const vin = normalizeVin(asset.vin);
    const decoded = decodedByVin.get(vin);
    if (!decoded) return asset;
    return {
      ...asset,
      vin: asset.vin || decoded.vin,
      make: asset.make || decoded.make || decoded.manufacturer,
      model: asset.model || decoded.model,
      year: asset.year || decoded.year,
      unitType: asset.unitType || (decoded.vehicleType === "TRAILER" ? "Trailer" : decoded.vehicleType === "TRUCK" ? "Truck" : ""),
      raw: {
        ...(asset.raw || {}),
        vinDecode: decoded,
      },
    };
  });
}
