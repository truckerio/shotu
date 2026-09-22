import { registerIntegrationProvider } from "../core/integration-provider.registry.js";
import { syncOdooPurchaseHistory, syncOdooServiceHistory } from "./odoo.admin.service.js";

export const odooAdapter = registerIntegrationProvider({
  provider: "odoo",
  capabilities: ["catalog_sync", "service_history_sync", "purchase_history_sync", "scheduled_jobs"],
  jobs: {
    async service_history_sync(job) {
      return syncOdooServiceHistory(job.company_id);
    },
    async purchase_history_sync(job) {
      return syncOdooPurchaseHistory(job.company_id);
    },
  },
});
