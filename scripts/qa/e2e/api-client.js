import { request as playwrightRequest } from "playwright";

export class RoleWorkflowHttpError extends Error {
  constructor(message, { status, code = "", path }) {
    super(message);
    this.name = "RoleWorkflowHttpError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

async function parsedBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export class RoleApiClient {
  constructor({ role, context, baseUrl }) {
    this.role = role;
    this.context = context;
    this.baseUrl = baseUrl;
    this.actor = null;
  }

  static async create({ role, baseUrl, timeoutMs }) {
    const context = await playwrightRequest.newContext({
      baseURL: baseUrl.origin,
      timeout: timeoutMs,
      extraHTTPHeaders: {
        accept: "application/json",
        origin: baseUrl.origin,
        "user-agent": "owl-role-workflow-e2e/1.0",
      },
    });
    return new RoleApiClient({ role, context, baseUrl });
  }

  async request(path, { method = "GET", body, expectedStatuses = [200] } = {}) {
    const response = await this.context.fetch(path, {
      method,
      data: body,
      failOnStatusCode: false,
    });
    const parsed = await parsedBody(response);
    if (!expectedStatuses.includes(response.status())) {
      throw new RoleWorkflowHttpError(
        parsed?.error || `Unexpected HTTP ${response.status()}.`,
        {
          status: response.status(),
          code: parsed?.code || "",
          path,
        },
      );
    }
    return { status: response.status(), body: parsed };
  }

  async authenticate(credentials) {
    await this.request("/api/auth/sign-in/username", {
      method: "POST",
      body: {
        username: credentials.username,
        password: credentials.password,
        rememberMe: false,
      },
    });
    const current = await this.request("/api/me");
    if (current.body?.user?.role !== this.role) {
      throw new Error(`QA ${this.role} account resolved to ${current.body?.user?.role || "no role"}.`);
    }
    this.actor = current.body.user;
    return this.actor;
  }

  storageState() {
    return this.context.storageState();
  }

  dispose() {
    return this.context.dispose();
  }
}
