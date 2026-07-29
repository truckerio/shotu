import { kioskDeviceTokenFromCookie, expiredKioskDeviceCookie } from "../modules/kiosk/kiosk-cookie.js";
import { kioskContextForToken, recordKioskEvent } from "../modules/kiosk/kiosk.service.js";
import { kioskEventSchema } from "../modules/kiosk/kiosk.schemas.js";

export async function handleKioskApi(req, res, url, helpers) {
  if (req.method === "GET" && url.pathname === "/api/kiosk/context") {
    const token = kioskDeviceTokenFromCookie(req.headers.cookie);
    const context = await kioskContextForToken(token);
    res.setHeader("cache-control", "no-store");
    if (!context) {
      if (token) res.setHeader("set-cookie", expiredKioskDeviceCookie());
      helpers.sendJson(res, 200, { registered: false });
      return true;
    }
    helpers.sendJson(res, 200, {
      registered: true,
      device: {
        id: context.device.id,
        name: context.device.name,
        locationId: context.device.locationId,
        locationName: context.device.locationName,
      },
      mechanics: context.mechanics,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/kiosk/event") {
    const input = kioskEventSchema.parse(await helpers.readBody(req));
    helpers.sendJson(res, 200, await recordKioskEvent({
      requestContext: helpers.requestContext,
      type: input.type,
    }));
    return true;
  }

  return false;
}
