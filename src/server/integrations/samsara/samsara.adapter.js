import {
  disconnectSamsara,
  samsaraStatus,
  syncSamsaraVehicles,
  testSamsaraConnection,
} from "./samsara.sync.service.js";
import {
  handleSamsaraOAuthCallback,
  samsaraOAuthStartUrl,
} from "./samsara.oauth.service.js";
import { registerIntegrationProvider } from "../core/integration-provider.registry.js";

export const samsaraAdapter = registerIntegrationProvider({
  provider: "samsara",
  capabilities: ["oauth", "connection_test", "asset_sync", "scheduled_jobs"],
  status: samsaraStatus,
  oauthStartUrl: samsaraOAuthStartUrl,
  oauthCallback: handleSamsaraOAuthCallback,
  test: testSamsaraConnection,
  sync: syncSamsaraVehicles,
  disconnect: disconnectSamsara,
  jobs: {
    async sync(job) {
      return syncSamsaraVehicles({
        companyId: job.company_id,
        syncType: job.payload?.syncType || "scheduled",
        allowApiTokenFallback: false,
      });
    },
  },
});
