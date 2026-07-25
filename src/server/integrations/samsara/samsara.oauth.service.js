import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { migrate } from "../../db/migrate.js";
import {
  findIntegrationByOAuthState,
  getIntegrationStatus,
  saveOAuthState,
  saveOAuthTokens,
} from "../../db/repositories/integrations.repo.js";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";

const PROVIDER = "samsara";
const TOKEN_REFRESH_SKEW_MS = 90_000;

function oauthBaseUrl() {
  return env.samsaraApiBaseUrl.replace(/\/+$/, "");
}

function requireOAuthConfig() {
  if (!env.samsaraOAuthClientId || !env.samsaraOAuthClientSecret) {
    throw new Error("SAMSARA_OAUTH_CLIENT_ID and SAMSARA_OAUTH_CLIENT_SECRET are required for Samsara login.");
  }
}

export function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

export function redirectUri(req) {
  return env.samsaraOAuthRedirectUri || `${requestOrigin(req)}/api/integrations/samsara/oauth/callback`;
}

function basicAuthHeader() {
  const auth = Buffer.from(`${env.samsaraOAuthClientId}:${env.samsaraOAuthClientSecret}`).toString("base64");
  return `Basic ${auth}`;
}

async function tokenRequest(body) {
  requireOAuthConfig();
  const response = await fetch(`${oauthBaseUrl()}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuthHeader(),
    },
    body: new URLSearchParams(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || payload.error || `Samsara OAuth failed with ${response.status}`);
  }
  return payload;
}

function expiresAtFromNow(expiresIn) {
  return new Date(Date.now() + Math.max(1, Number(expiresIn) || 3600) * 1000).toISOString();
}

export async function samsaraOAuthStartUrl(req, companyId = DEFAULT_COMPANY_ID) {
  await migrate();
  requireOAuthConfig();
  const state = crypto.randomBytes(24).toString("base64url");
  await saveOAuthState(PROVIDER, state, companyId);
  const url = new URL(`${oauthBaseUrl()}/oauth2/authorize`);
  url.searchParams.set("client_id", env.samsaraOAuthClientId);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (env.samsaraOAuthRedirectUri) url.searchParams.set("redirect_uri", redirectUri(req));
  return url.toString();
}

export async function handleSamsaraOAuthCallback(url) {
  await migrate();
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(url.searchParams.get("error_description") || error);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("Samsara OAuth callback is missing code or state.");

  const account = await findIntegrationByOAuthState(PROVIDER, state);
  const stateAgeMs = account?.oauth_state_created_at ? Date.now() - new Date(account.oauth_state_created_at).getTime() : Infinity;
  if (!account?.oauth_state || account.oauth_state !== state || stateAgeMs > 10 * 60 * 1000) {
    throw new Error("Samsara OAuth state did not match. Please start login again.");
  }

  const tokens = await tokenRequest({ grant_type: "authorization_code", code });
  return saveOAuthTokens(PROVIDER, {
    status: "connected",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresAt: expiresAtFromNow(tokens.expires_in),
  }, account.company_id);
}

export async function getSamsaraAccessToken({
  allowApiTokenFallback = true,
  companyId = DEFAULT_COMPANY_ID,
} = {}) {
  await migrate();
  const account = await getIntegrationStatus(PROVIDER, companyId);
  if (account?.access_token && account?.expires_at && new Date(account.expires_at).getTime() - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return { token: account.access_token, source: "oauth" };
  }

  if (account?.refresh_token) {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: account.refresh_token });
    const saved = await saveOAuthTokens(PROVIDER, {
      status: "connected",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || account.refresh_token,
      tokenType: tokens.token_type,
      scope: tokens.scope || account.scope,
      expiresAt: expiresAtFromNow(tokens.expires_in),
    }, companyId);
    return { token: tokens.access_token, source: saved.token_env_key || "oauth" };
  }

  if (allowApiTokenFallback && companyId === DEFAULT_COMPANY_ID && env.samsaraApiToken) {
    return { token: env.samsaraApiToken, source: "env" };
  }
  throw new Error("Connect Samsara with OAuth before syncing vehicles.");
}
