import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { admin, username } from "better-auth/plugins";
import { getPool } from "../db/pool.js";
import { resolveAuthConfig } from "./config.js";
import { kioskAuthPlugin } from "./kiosk-plugin.js";
import { sendPasswordResetEmail } from "../email/password-reset.js";

const config = resolveAuthConfig();
const authOrigin = new URL(config.baseURL).origin;
const relyingPartyId = new URL(authOrigin).hostname;

export const auth = betterAuth({
  appName: "Workorder Generator",
  baseURL: config.baseURL,
  secret: config.secret,
  trustedOrigins: config.trustedOrigins,
  database: getPool(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 15,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: sendPasswordResetEmail,
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
      "/request-password-reset": { window: 60, max: 5 },
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
    passkey({
      rpID: relyingPartyId,
      rpName: "Owl",
      origin: authOrigin,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      registration: {
        requireSession: true,
      },
      schema: {
        passkey: {
          modelName: "auth_passkey",
          fields: {
            publicKey: "public_key",
            userId: "user_id",
            credentialID: "credential_id",
            deviceType: "device_type",
            backedUp: "backed_up",
            createdAt: "created_at",
          },
        },
      },
    }),
  ],
});
