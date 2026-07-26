import { performance } from "node:perf_hooks";
import { CookieJar } from "./cookie-jar.js";

export class HttpResponseError extends Error {
  constructor(message, { status = 0, code = "", path = "" } = {}) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export class LoadHttpClient {
  constructor({ baseUrl, requestTimeoutMs, role }) {
    this.baseUrl = baseUrl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.role = role;
    this.jar = new CookieJar();
  }

  async request(path, options = {}) {
    const {
      method = "GET",
      body,
      expectedStatuses = [200],
      signal,
    } = options;
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error("Request timed out.")),
      this.requestTimeoutMs,
    );
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    const headers = {
      accept: "application/json",
      origin: this.baseUrl.origin,
      "user-agent": "workorder-production-gate/1.0",
    };
    const cookie = this.jar.header();
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";

    const started = performance.now();
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: combinedSignal,
      });
      this.jar.absorb(response.headers);
      const parsed = await responseBody(response);
      const durationMs = performance.now() - started;
      if (!expectedStatuses.includes(response.status)) {
        throw new HttpResponseError(
          parsed?.error || `Unexpected HTTP ${response.status}.`,
          { status: response.status, code: parsed?.code || "", path },
        );
      }
      return { response, body: parsed, durationMs };
    } catch (error) {
      if (error instanceof HttpResponseError) throw error;
      const wrapped = new HttpResponseError(
        combinedSignal.aborted ? "Request aborted or timed out." : "Network request failed.",
        { path },
      );
      wrapped.cause = error;
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function authenticateRole(client, credentials) {
  const isEmail = credentials.identifier.includes("@");
  const path = isEmail
    ? "/api/auth/sign-in/email"
    : "/api/auth/sign-in/username";
  const identifierField = isEmail ? "email" : "username";
  await client.request(path, {
    method: "POST",
    body: {
      [identifierField]: credentials.identifier,
      password: credentials.password,
      rememberMe: false,
    },
    expectedStatuses: [200],
  });
  if (client.jar.size === 0) {
    throw new Error(`Authentication for ${client.role} did not establish a cookie session.`);
  }
  const current = await client.request("/api/me");
  const actualRole = current.body?.user?.role;
  if (actualRole !== client.role) {
    throw new Error(`Configured ${client.role} credentials resolved to role ${actualRole || "unknown"}.`);
  }
  return current.body.user;
}
