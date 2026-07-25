import { closePool, query } from "../../db/pool.js";
import { findLivePartPrices, identifyPart } from "./parts-helper.service.js";

const location = {
  country: "US",
  city: "Chino",
  region: "CA",
  postalCode: "91710",
  timezone: "America/Los_Angeles",
};

const componentScenarios = {
  volvo: [
    { component: "engine oil filter", query: "21707133" },
    { component: "NOx sensor", query: "22827993" },
    { component: "exhaust bellows", query: "21428536" },
    { component: "cooling system", query: "engine coolant thermostat" },
    { component: "air brake system", query: "front brake chamber" },
  ],
  peterbilt: [
    { component: "engine oil filter", query: "LF14000NN" },
    { component: "fuel filter", query: "FF5776" },
    { component: "NOx sensor", query: "4326872" },
    { component: "air system", query: "air dryer cartridge" },
    { component: "cab filtration", query: "cab air filter" },
  ],
  cascadia: [
    { component: "engine oil filter", query: "A4721800309" },
    { component: "fuel filter kit", query: "A0000905051" },
    { component: "NOx sensor", query: "A0009053503" },
    { component: "belt tensioner", query: "A4722001070" },
    { component: "engine sensor", query: "oil pressure sensor" },
  ],
};

const familySql = `
  case
    when lower(make) like '%volvo%' then 'volvo'
    when lower(make) like '%peterbilt%' then 'peterbilt'
    else 'cascadia'
  end
`;

async function selectFleetTrucks() {
  const result = await query(`
    with candidates as (
      select id, unit_no, vin, make, model, year, last_odometer_miles,
             ${familySql} as family,
             row_number() over (
               partition by ${familySql}
               order by
                 case
                   when lower(make) like '%volvo%' and year = 2020 then 0
                   when lower(make) like '%peterbilt%' and year = 2022 then 0
                   when lower(model) like '%cascadia%' and year = 2020 then 0
                   else 1
                 end,
                 year desc nulls last,
                 unit_no
             ) as rank
      from assets
      where unit_type = 'Truck'
        and length(vin) = 17
        and (
          lower(make) like '%volvo%'
          or lower(make) like '%peterbilt%'
          or lower(model) like '%cascadia%'
        )
    )
    select id, unit_no, vin, make, model, year, last_odometer_miles, family
    from candidates
    where rank = 1
    order by family
  `);
  if (result.rows.length !== 3) throw new Error(`Expected three supported Samsara trucks; found ${result.rows.length}.`);
  return result.rows;
}

async function decodeEngines(trucks) {
  const response = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ format: "json", data: trucks.map((truck) => truck.vin).join(";") }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = response.ok ? await response.json() : { Results: [] };
  const decodedByVin = new Map((body.Results || []).map((row) => [row.VIN, row]));
  const fallback = { volvo: "Volvo D13", peterbilt: "Cummins X15", cascadia: "Detroit DD15" };
  return trucks.map((truck) => {
    const decoded = decodedByVin.get(truck.vin) || {};
    const decodedEngine = [decoded.EngineManufacturer, decoded.EngineModel].filter(Boolean).join(" ").trim();
    return {
      ...truck,
      engine: decodedEngine || fallback[truck.family],
      engineSource: decodedEngine ? "nhtsa_vin" : "scenario_assumption",
    };
  });
}

const maskVin = (vin) => `${vin.slice(0, 4)}*********${vin.slice(-4)}`;

const moneyRange = (listings) => {
  const prices = listings.map((listing) => listing.itemPrice).filter(Number.isFinite);
  if (!prices.length) return null;
  return { low: Math.min(...prices), high: Math.max(...prices) };
};

async function runScenario(truck, scenario) {
  const vehicle = {
    assetId: truck.id,
    unitNo: truck.unit_no,
    vin: truck.vin,
    make: truck.make,
    model: truck.model,
    year: truck.year,
    engine: truck.engine,
  };
  const startedAt = Date.now();
  try {
    const identification = await identifyPart({ query: scenario.query, vehicle, location });
    const part = identification.part;
    let pricing = null;
    let pricingError = "";
    if (part.status === "matched" && part.normalizedPartNumber) {
      try {
        pricing = await findLivePartPrices({
          partNumber: part.normalizedPartNumber,
          manufacturer: part.manufacturer,
          description: part.description,
          quantity: part.suggestedQuantity,
          vehicle,
          location,
        });
      } catch (error) {
        pricingError = error.message;
      }
    }
    const confirmedListingCount = pricing?.listings.filter((listing) => listing.fitmentStatus === "confirmed").length || 0;
    const readyToOrder = part.fitmentStatus === "confirmed" && confirmedListingCount > 0;
    return {
      family: truck.family,
      unitNo: truck.unit_no,
      vehicle: `${truck.year} ${truck.make} ${truck.model}`,
      maskedVin: maskVin(truck.vin),
      engine: truck.engine,
      engineSource: truck.engineSource,
      requestedComponent: scenario.component,
      mechanicInput: scenario.query,
      identificationStatus: part.status,
      normalizedPartNumber: part.normalizedPartNumber,
      manufacturer: part.manufacturer,
      description: part.description,
      category: part.category,
      repairOrder: part.repairOrder,
      confidence: part.confidence,
      fitmentStatus: part.fitmentStatus,
      listingCount: pricing?.listings.length || 0,
      confirmedListingCount,
      priceRange: pricing ? moneyRange(pricing.listings) : null,
      pricingError,
      readyToOrder,
      nextAction: readyToOrder
        ? "Office may review the confirmed listing."
        : part.status === "matched"
          ? "Confirm VIN or engine fitment before ordering."
          : part.normalizedPartNumber
            ? "Verify the candidate part number and fitment by VIN or engine serial."
            : "Mechanic must provide an exact part number or clearer description.",
      durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    };
  } catch (error) {
    return {
      family: truck.family,
      unitNo: truck.unit_no,
      vehicle: `${truck.year} ${truck.make} ${truck.model}`,
      maskedVin: maskVin(truck.vin),
      engine: truck.engine,
      engineSource: truck.engineSource,
      requestedComponent: scenario.component,
      mechanicInput: scenario.query,
      error: error.message,
      durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    };
  }
}

async function runWithConcurrency(entries, concurrency) {
  const results = new Array(entries.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const { truck, scenario } = entries[index];
      results[index] = await runScenario(truck, scenario);
      console.log(JSON.stringify({ progress: `${index + 1}/${entries.length}`, result: results[index] }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return results;
}

function summarize(results) {
  const successful = results.filter((result) => !result.error);
  const count = (field, value) => successful.filter((result) => result[field] === value).length;
  return {
    scenarios: results.length,
    completed: successful.length,
    errors: results.length - successful.length,
    matched: count("identificationStatus", "matched"),
    ambiguous: count("identificationStatus", "ambiguous"),
    notFound: count("identificationStatus", "not_found"),
    fitmentConfirmed: count("fitmentStatus", "confirmed"),
    readyToOrder: count("readyToOrder", true),
    scenariosWithListings: successful.filter((result) => result.listingCount > 0).length,
    pricingErrors: successful.filter((result) => result.pricingError).length,
  };
}

try {
  const trucks = await decodeEngines(await selectFleetTrucks());
  console.log(JSON.stringify({ fleetSelection: trucks.map((truck) => ({
    family: truck.family,
    unitNo: truck.unit_no,
    vehicle: `${truck.year} ${truck.make} ${truck.model}`,
    maskedVin: maskVin(truck.vin),
    engine: truck.engine,
    engineSource: truck.engineSource,
  })) }));
  const entries = trucks.flatMap((truck) => componentScenarios[truck.family].map((scenario) => ({ truck, scenario })));
  const results = await runWithConcurrency(entries, 3);
  console.log(JSON.stringify({ summary: summarize(results) }));
} finally {
  await closePool();
}
