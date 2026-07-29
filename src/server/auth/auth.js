import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { getPool } from "../db/pool.js";
import { resolveAuthConfig } from "./config.js";
import { kioskAuthPlugin } from "./kiosk-plugin.js";

const config = resolveAuthConfig();

export const auth = betterAuth({
  appName: "Workorder Generator",
  baseURL: config.baseURL,
  secret: config.secret,
  trustedOrigins: config.trustedOrigins,
  database: getPool(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
  user: {
    modelName: "auth_user",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
      displayUsername: "display_username",
    },
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },
  session: {
    modelName: "auth_session",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    cookieCache: { enabled: false },
  },
  account: {
    modelName: "auth_account",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verification",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  advanced: {
    cookiePrefix: "workorder",
    useSecureCookies: config.secureCookies,
    ...(config.ipAddressHeaders.length ? {
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders },
    } : {}),
  },
  rateLimit: {
    enabled: config.rateLimitEnabled,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/username": { window: 60, max: 10 },
      "/forget-password": { window: 300, max: 5 },
    },
  },
  disabledPaths: ["/sign-up/email", "/is-username-available"],
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 50,
      schema: {
        user: {
          fields: {
            username: "username",
            displayUsername: "display_username",
          },
        },
      },
    }),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      schema: {
        user: {
          fields: {
            role: "auth_role",
            banned: "banned",
            banReason: "ban_reason",
            banExpires: "ban_expires",
          },
        },
        session: {
          fields: {
            impersonatedBy: "impersonated_by",
          },
        },
      },
    }),
    kioskAuthPlugin(),
  ],
});
