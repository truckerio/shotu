import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createAuthEndpoint } from "@better-auth/core/api";
import {
  beginKioskUnlock,
  finishKioskUnlock,
} from "../modules/kiosk/kiosk.service.js";
import { kioskDeviceTokenFromCookie } from "../modules/kiosk/kiosk-cookie.js";
import { KioskPinChangeRequiredError, KioskUnlockError } from "../modules/kiosk/kiosk-errors.js";
import { kioskUnlockSchema } from "../modules/kiosk/kiosk.schemas.js";
import { createInMemoryRateLimiter } from "../security/rate-limit.js";
import { hashKioskDeviceToken } from "../modules/kiosk/kiosk.service.js";

const GENERIC_ERROR = "Unable to unlock kiosk.";
const deviceUnlockLimiter = createInMemoryRateLimiter({
  limit: 10,
  windowMs: 60_000,
});

export function kioskAuthPlugin(dependencies = {}) {
  const beginUnlock = dependencies.beginUnlock || beginKioskUnlock;
  const finishUnlock = dependencies.finishUnlock || finishKioskUnlock;
  const readDeviceToken = dependencies.readDeviceToken || kioskDeviceTokenFromCookie;

  return {
    id: "mechanic-kiosk",
    endpoints: {
      kioskUnlock: createAuthEndpoint("/kiosk/unlock", {
        method: "POST",
        body: kioskUnlockSchema,
      }, async (ctx) => {
        const cookieHeader = ctx.request?.headers.get("cookie") || ctx.headers?.get("cookie") || "";
        const deviceToken = readDeviceToken(cookieHeader);
        if (!deviceToken) throw new APIError("UNAUTHORIZED", { message: GENERIC_ERROR });
        if (!deviceUnlockLimiter.consume(hashKioskDeviceToken(deviceToken)).allowed) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many requests. Try again later." });
        }

        let unlock;
        try {
          unlock = await beginUnlock({ deviceToken, ...ctx.body });
        } catch (error) {
          if (error instanceof KioskPinChangeRequiredError) {
            throw new APIError("BAD_REQUEST", { message: "A new PIN is required." });
          }
          if (error instanceof KioskUnlockError) {
            throw new APIError(error.kind === "locked" ? "LOCKED" : "UNAUTHORIZED", {
              message: GENERIC_ERROR,
            });
          }
          if (error?.statusCode === 400) {
            throw new APIError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }

        const user = await ctx.context.adapter.findOne({
          model: "user",
          where: [{ field: "id", value: unlock.prepared.authUserId }],
        });
        if (!user) throw new APIError("UNAUTHORIZED", { message: GENERIC_ERROR });

        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to create kiosk session." });
        }

        try {
          await finishUnlock({
            prepared: unlock.prepared,
            sessionId: session.id,
            newPinHash: unlock.newPinHash,
          });
        } catch (error) {
          await ctx.context.internalAdapter.deleteSession(session.token).catch(() => {});
          if (error instanceof KioskUnlockError) {
            throw new APIError("UNAUTHORIZED", { message: GENERIC_ERROR });
          }
          throw error;
        }

        await setSessionCookie(ctx, { session, user });
        ctx.setHeader("cache-control", "no-store");
        return ctx.json({
          user: {
            id: unlock.prepared.userId,
            name: user.name,
          },
          requiresPinChange: false,
        });
      }),
    },
  };
}
