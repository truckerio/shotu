import { findHuggingFaceTruckContext } from "./providers/huggingface.provider.js";

const samples = [
  { make: "Volvo", model: "VNL" },
  { make: "Peterbilt", model: "579" },
  { make: "Freightliner", model: "Cascadia" },
];

for (const vehicle of samples) {
  const result = await findHuggingFaceTruckContext(vehicle);
  console.log(JSON.stringify({ input: vehicle, matched: result.matched, family: result.family, vehicle: result.vehicle }, null, 2));
}

