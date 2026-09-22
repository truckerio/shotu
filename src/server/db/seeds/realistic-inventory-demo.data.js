export const REALISTIC_INVENTORY_DEMO_KEY = "realistic-inventory-existing-parts-v2";
export const PREVIOUS_FIXTURE_KEY = "realistic-inventory-demo-v1";

const CHINO_EXPANSION_AISLES = [
  [5, 6, 7, "Electrical", "Electrical service parts"],
  [6, 7, 8, "Engine", "Engine service parts"],
  [7, 8, 9, "Cooling", "Cooling system parts"],
  [8, 9, 10, "Air system", "Air system parts"],
  [9, 10, 11, "Suspension", "Suspension parts"],
  [10, 11, 12, "Driveline", "Driveline parts"],
  [11, 12, 13, "Cab and body", "Cab and body parts"],
  [12, 13, 14, "Shop supplies", "Common shop supplies"],
].flatMap(([aisle, shelf, bin, name, binName]) => [
  { key: `aisle-${aisle}`, parent: "warehouse", legacyCode: `A${aisle}`, code: `A${aisle}`, name, kind: "aisle" },
  { key: `shelf-${shelf}`, parent: `aisle-${aisle}`, legacyCode: `S${shelf}`, code: `S${shelf}`, name: `${name} shelf`, kind: "shelf" },
  { key: `bin-${bin}`, parent: `shelf-${shelf}`, legacyCode: `B${bin}`, code: `B${bin}`, name: binName, kind: "bin", stores: true },
]);

export const DEMO_SHOPS = [
  { key: "chino", name: "Chino Yard", positions: [
    { key: "warehouse", legacyCode: "WH", legacyCodes: ["WH", "CH-WH"], code: "W1", name: "Warehouse 1", kind: "warehouse" },
    { key: "warehouse-2", legacyCode: "W2", code: "W2", name: "Warehouse 2", kind: "warehouse" },
    { key: "warehouse-3", legacyCode: "W3", code: "W3", name: "Warehouse 3", kind: "warehouse" },
    { key: "core", legacyCode: "CORE", code: "CORE", name: "Core area", kind: "area" },
    { key: "aisle-a", parent: "warehouse", legacyCode: "CH-A", legacyCodes: ["A1", "CH-A"], code: "A1", name: "Filters and brakes", kind: "aisle" },
    { key: "shelf-a1", parent: "aisle-a", legacyCode: "CH-A1", code: "S1", name: "Service filters and brake pads", kind: "shelf" },
    { key: "bin-a1-01", parent: "shelf-a1", legacyCode: "CH-A1-01", code: "B1", name: "Brake pads", kind: "bin", stores: true },
    { key: "bin-a1-02", parent: "shelf-a1", legacyCode: "CH-A1-02", code: "B2", name: "Oil filters", kind: "bin", stores: true },
    { key: "shelf-a2", parent: "aisle-a", legacyCode: "CH-A2", code: "S2", name: "Wheel-end parts", kind: "shelf" },
    { key: "bin-a2-01", parent: "shelf-a2", legacyCode: "CH-A2-01", code: "B3", name: "Wheel seals", kind: "bin", stores: true },
    { key: "heavy", parent: "warehouse", legacyCode: "CH-HEAVY", legacyCodes: ["A2", "CH-HEAVY"], code: "A2", name: "Heavy parts", kind: "aisle" },
    { key: "rack-h1", parent: "heavy", legacyCode: "R1", legacyCodes: ["R1", "CH-H1"], code: "S3", name: "Heavy parts shelf", kind: "shelf" },
    { key: "bay-h1-01", parent: "rack-h1", legacyCode: "CH-H1-01", code: "B4", name: "Batteries and air lines", kind: "bin", stores: true },
    { key: "fluids", parent: "warehouse", legacyCode: "CH-FLUID", legacyCodes: ["A3", "CH-FLUID"], code: "A3", name: "Fluids", kind: "aisle" },
    { key: "fluid-shelf", parent: "fluids", legacyCode: "S4", code: "S4", name: "Engine fluids shelf", kind: "shelf" },
    { key: "fluid-bin", parent: "fluid-shelf", legacyCode: "CH-FL-01", code: "B5", name: "Packaged engine oil", kind: "bin", stores: true },
    { key: "tire-cage", parent: "warehouse", legacyCode: "CH-TIRE", legacyCodes: ["A4", "CH-TIRE"], code: "A4", name: "Tires", kind: "aisle" },
    { key: "tire-rack", parent: "tire-cage", legacyCode: "R2", legacyCodes: ["R2", "CH-TR-01"], code: "S5", name: "Truck tire shelf", kind: "shelf" },
    { key: "tire-bay", parent: "tire-rack", legacyCode: "CH-TR-01-A", code: "B6", name: "Truck tires", kind: "bin", stores: true },
    ...CHINO_EXPANSION_AISLES,
  ] },
  { key: "arizona", name: "Arizona Yard", positions: [
    { key: "room", legacyCode: "AZ-ROOM", code: "WH", name: "Parts room", kind: "room" },
    { key: "aisle", parent: "room", legacyCode: "AZ-A", code: "A1", name: "Service parts", kind: "aisle" },
    { key: "shelf", parent: "aisle", legacyCode: "AZ-A1", code: "S1", name: "Filters and seals", kind: "shelf" },
    { key: "bin", parent: "shelf", legacyCode: "AZ-A1-01", code: "B1", name: "Filters and wheel seals", kind: "bin", stores: true },
    { key: "fluid-area", parent: "room", legacyCode: "AZ-FLUID", code: "A2", name: "Fluids", kind: "area" },
    { key: "fluid-bin", parent: "fluid-area", legacyCode: "AZ-FL-01", code: "B2", name: "Packaged engine oil", kind: "bin", stores: true },
  ] },
  { key: "texas", name: "Texas Yard", positions: [
    { key: "warehouse", legacyCode: "TX-WH", code: "WH", name: "Service parts warehouse", kind: "warehouse" },
    { key: "rack", parent: "warehouse", legacyCode: "TX-R1", code: "R1", name: "General parts rack", kind: "rack" },
    { key: "bin", parent: "rack", legacyCode: "TX-R1-01", code: "B1", name: "Filters and batteries", kind: "bin", stores: true },
    { key: "secure", parent: "warehouse", legacyCode: "TX-SECURE", code: "A1", name: "Secure parts", kind: "area" },
    { key: "secure-bin", parent: "secure", legacyCode: "TX-SEC-01", code: "B2", name: "Fuel pumps", kind: "bin", stores: true },
  ] },
  { key: "newjersey", name: "New Jersey Yard", positions: [
    { key: "warehouse", legacyCode: "NJ-WH", code: "WH", name: "Parts warehouse", kind: "warehouse" },
    { key: "aisle", parent: "warehouse", legacyCode: "NJ-A1", code: "A1", name: "Service parts", kind: "aisle" },
    { key: "shelf", parent: "aisle", legacyCode: "NJ-A1-S1", code: "S1", name: "Filters and air lines", kind: "shelf" },
    { key: "bin", parent: "shelf", legacyCode: "NJ-A1-S1-B1", code: "B1", name: "Oil filters and air lines", kind: "bin", stores: true },
  ] },
];

// The seed resolves these existing catalog records instead of creating parts.
export const DEMO_PARTS = [
  { key: "brake-pad", partNumber: "141.D1370FS", cost: 84.50, tracking: "quantity" },
  { key: "oil-filter", partNumber: "101D/LF3970", cost: 24.75, tracking: "quantity" },
  { key: "engine-oil", partNumber: "550045127", cost: 58.40, tracking: "quantity" },
  { key: "bulk-oil", partNumber: "000628509", cost: 6.25, tracking: "measured_bulk", uomCode: "qt" },
  { key: "fuel-pump", partNumber: "FUEL PUMP", cost: 468.00, tracking: "serialized" },
  { key: "air-hose", partNumber: "177.7860", cost: 31.10, tracking: "quantity" },
  { key: "air-dryer", partNumber: "109994K", cost: 72.00, tracking: "quantity" },
  { key: "wheel-seal", partNumber: "370001A", cost: 39.00, tracking: "quantity" },
  { key: "battery", partNumber: "000053436", cost: 189.00, tracking: "quantity" },
  { key: "tire", partNumber: "233-755", cost: 512.00, tracking: "quantity" },
];

export const DEMO_STOCK = [
  { shop: "chino", part: "brake-pad", position: "bin-a1-01", received: 24, onHand: 24, reserved: 2 },
  { shop: "chino", part: "oil-filter", position: "bin-a1-02", received: 18, onHand: 18 },
  { shop: "chino", part: "wheel-seal", position: "bin-a2-01", received: 12, onHand: 12 },
  { shop: "chino", part: "engine-oil", position: "fluid-bin", received: 10, onHand: 8 },
  { shop: "chino", part: "bulk-oil", position: "fluid-bin", received: 12.5, onHand: 12.5 },
  { shop: "chino", part: "battery", position: "bay-h1-01", received: 6, onHand: 6 },
  { shop: "chino", part: "air-hose", position: "bay-h1-01", received: 12, onHand: 12 },
  { shop: "chino", part: "tire", position: "tire-bay", received: 4, onHand: 4 },
  { shop: "arizona", part: "brake-pad", position: "bin", received: 8, onHand: 8 },
  { shop: "arizona", part: "wheel-seal", position: "bin", received: 6, onHand: 6 },
  { shop: "arizona", part: "engine-oil", position: "fluid-bin", received: 4, onHand: 4 },
  { shop: "texas", part: "brake-pad", position: "bin", received: 4, onHand: 4 },
  { shop: "texas", part: "oil-filter", position: "bin", received: 6, onHand: 6 },
  { shop: "texas", part: "fuel-pump", position: "secure-bin", received: 1, onHand: 1, serials: ["FP-TX-2001"] },
  { shop: "texas", part: "battery", position: "bin", received: 4, onHand: 4 },
  { shop: "newjersey", part: "oil-filter", position: "bin", received: 4, onHand: 4 },
  { shop: "newjersey", part: "air-hose", position: "bin", received: 3, onHand: 3 },
];

export const DEMO_WORKORDERS = [
  { key: "brakes", serial: "TEST-WO-CHINO-001", shop: "chino", status: "in_progress", unitNo: "CH-1842", concern: "Brake vibration and low pad warning", diagnosis: "Front pads are below service limit.", part: "brake-pad", quantity: 2, request: "approved", usage: "reserved", repairOrder: "Replace front brake pads" },
  { key: "air-line", serial: "TEST-WO-CHINO-002", shop: "chino", status: "accepted", unitNo: "CH-2217", concern: "Air pressure drops overnight", diagnosis: "Leak found in frame rail air hose assembly.", part: "air-hose", quantity: 1, request: "approved", usage: null, repairOrder: "Replace damaged air hose" },
  { key: "oil-service", serial: "TEST-WO-CHINO-003", shop: "chino", status: "closed", unitNo: "CH-3904", concern: "Preventive maintenance service", diagnosis: "Scheduled engine service due.", workPerformed: "Changed packaged engine oil and filter; completed leak check.", part: "engine-oil", quantity: 2, request: "approved", usage: "consumed", repairOrder: "Engine oil service" },
  { key: "dryer", serial: "TEST-WO-TEXAS-001", shop: "texas", status: "in_progress", unitNo: "TX-7710", concern: "Air dryer purges continuously", diagnosis: "Air dryer cartridge requires replacement.", part: "air-dryer", quantity: 1, request: "submitted", usage: null, repairOrder: "Replace air dryer cartridge" },
  { key: "wheel-end", serial: "TEST-WO-ARIZONA-001", shop: "arizona", status: "accepted", unitNo: "AZ-6088", concern: "Oil visible around drive hub", diagnosis: "Drive axle wheel seal is leaking.", part: "wheel-seal", quantity: 1, request: "approved", usage: null, repairOrder: "Replace drive axle wheel seal" },
];

export function validateRealisticInventoryDemo() {
  const shopKeys = new Set(DEMO_SHOPS.map((shop) => shop.key));
  const partKeys = new Set(DEMO_PARTS.map((part) => part.key));
  if (shopKeys.size !== DEMO_SHOPS.length || partKeys.size !== DEMO_PARTS.length) throw new Error("Fixture shop and part keys must be unique.");
  for (const shop of DEMO_SHOPS) {
    const positions = new Map(shop.positions.map((position) => [position.key, position]));
    for (const position of shop.positions) if (position.parent && !positions.has(position.parent)) throw new Error(`${shop.name} position ${position.key} has an unknown parent.`);
    if (!shop.positions.some((position) => position.stores)) throw new Error(`${shop.name} requires at least one storable position.`);
  }
  for (const stock of DEMO_STOCK) {
    const shop = DEMO_SHOPS.find((candidate) => candidate.key === stock.shop);
    const part = DEMO_PARTS.find((candidate) => candidate.key === stock.part);
    const position = shop?.positions.find((candidate) => candidate.key === stock.position);
    if (!shop || !part || !position?.stores) throw new Error(`Invalid stock placement ${stock.shop}/${stock.part}/${stock.position}.`);
    if (stock.onHand < 0 || (stock.reserved || 0) > stock.onHand || stock.received < stock.onHand) throw new Error(`Invalid stock quantity for ${stock.part} at ${stock.shop}.`);
    if (part.tracking === "serialized" && (!Array.isArray(stock.serials) || stock.serials.length !== stock.onHand)) throw new Error(`Serialized stock ${stock.part} requires one serial per on-hand unit.`);
    if (part.tracking !== "serialized" && stock.serials) throw new Error(`Aggregate stock ${stock.part} cannot define serial numbers.`);
  }
  const trackingModes = new Set(DEMO_PARTS.map((part) => part.tracking));
  if (!["quantity", "measured_bulk", "serialized"].every((mode) => trackingModes.has(mode))) throw new Error("Fixture must cover quantity, measured/bulk, and serialized tracking.");
  for (const workorder of DEMO_WORKORDERS) if (!shopKeys.has(workorder.shop) || !partKeys.has(workorder.part)) throw new Error(`Invalid workorder ${workorder.serial}.`);
  return { shops: DEMO_SHOPS.length, positions: DEMO_SHOPS.reduce((sum, shop) => sum + shop.positions.length, 0), parts: DEMO_PARTS.length, stockPlacements: DEMO_STOCK.length, workorders: DEMO_WORKORDERS.length };
}
