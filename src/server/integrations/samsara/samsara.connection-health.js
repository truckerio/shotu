import { upsertIntegrationStatus } from "../../db/repositories/integrations.repo.js";
import {
  IntegrationHttpError,
  integrationAuthenticationRequired,
  integrationPermissionDenied,
} from "../core/integration-errors.js";
import { isRejectedSamsaraApiCredential } from "./samsara.client.js";

export function samsaraConnectionError(error) {
  if (error instanceof IntegrationHttpError) return error;
  if (isRejectedSamsaraApiCredential(error)) {
    return integrationAuthenticationRequired(
      "Samsara rejected the saved credential. Reconnect Samsara in Settings.",
    );
  }
  if (Number(error?.status) === 403) {
    return integrationPermissionDenied(
      "Samsara needs Read Vehicles and Read Tags access. Update the Samsara app permissions, then reconnect.",
    );
  }
  return new IntegrationHttpError(
    502,
    "SAMSARA_UNAVAILABLE",
    "Samsara could not be reached. Try again shortly.",
  );
}

export async function recordSamsaraConnectionFailure(companyId, error) {
  await upsertIntegrationStatus("samsara", { status: "error" }, companyId);
  return samsaraConnectionError(error);
}
