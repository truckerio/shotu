import { Cloud01 } from "@untitledui/icons";

export const integrationProviders = [
  {
    id: "samsara",
    name: "Samsara",
    category: "Fleet telematics",
    description: "Sync units, trailers, odometers, and last known locations.",
    icon: Cloud01,
  },
  {
    id: "odoo",
    name: "Odoo.sh",
    category: "Parts and inventory",
    description: "Import the parts catalog and inventory from explicitly mapped Odoo locations.",
    icon: Cloud01,
  },
];

export function integrationProvider(providerId) {
  return integrationProviders.find((provider) => provider.id === providerId) || null;
}
