import { IntegrationHttpError } from "../core/integration-errors.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 500;
const MAX_RECORDS = 25_000;

function transportMessage(error, baseUrl) {
  const code = error?.cause?.code || error?.code;
  if (["ENOTFOUND", "ENOENT", "EAI_AGAIN"].includes(code)) {
    return `Cannot resolve the Odoo server ${new URL(baseUrl).hostname}. Check the current Odoo.sh URL and that the staging build is running. Credentials could not be verified.`;
  }
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code)) {
    return "The Odoo server certificate could not be verified. Check the server certificate and this computer's trusted certificates.";
  }
  if (code === "ECONNREFUSED" || error?.cause?.errors?.some((entry) => entry.code === "ECONNREFUSED")) {
    return "The Odoo server refused the connection. Check that the configured Odoo.sh build is running and reachable.";
  }
  return "The Odoo connection ended before a response was received.";
}

function normalizedBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Odoo URL must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

export class OdooClient {
  constructor({ baseUrl, database, username, apiKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.database = database;
    this.username = username;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.uid = null;
    this.requestId = 0;
  }

  async rpc(service, method, args) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          params: { service, method, args },
          id: ++this.requestId,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        const message = payload?.error?.data?.message || payload?.error?.message || `Odoo returned HTTP ${response.status}.`;
        throw new Error(message);
      }
      return payload.result;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new IntegrationHttpError(504, "ODOO_CONNECTION_TIMEOUT", "Odoo did not respond before the connection timeout.");
      }
      if (error instanceof TypeError) {
        // Preserve the transport code: outbound writes must still reconcile an
        // uncertain result rather than automatically repeat a create operation.
        throw new IntegrationHttpError(503, "ODOO_TRANSPORT_ERROR", transportMessage(error, this.baseUrl));
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async authenticate() {
    if (this.uid) return this.uid;
    const uid = await this.rpc("common", "authenticate", [this.database, this.username, this.apiKey, {}]);
    if (!uid) throw new Error("Odoo rejected the database, username, or API key.");
    this.uid = uid;
    return uid;
  }

  async execute(model, method, args = [], kwargs = {}) {
    const uid = await this.authenticate();
    return this.rpc("object", "execute_kw", [
      this.database,
      uid,
      this.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async searchReadAll(model, domain, fields, { context } = {}) {
    const records = [];
    for (let offset = 0; offset < MAX_RECORDS; offset += PAGE_SIZE) {
      const page = await this.execute(model, "search_read", [domain], {
        fields,
        limit: PAGE_SIZE,
        offset,
        order: "id asc",
        ...(context ? { context } : {}),
      });
      records.push(...page);
      if (page.length < PAGE_SIZE) return records;
    }
    throw new Error(`Odoo ${model} sync exceeded the ${MAX_RECORDS}-record safety limit.`);
  }
}

export function createOdooClient(configuration, options) {
  return new OdooClient(configuration, options);
}
