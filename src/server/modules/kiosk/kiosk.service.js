import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  completeKioskUnlock,
  createKioskDevice,
  getEligibleMechanicForKioskPin,
  getRegisteredKioskContext,
  listKioskDevices,
  prepareKioskUnlock,
  recordKioskSessionEvent,
  revokeKioskDevice,
  saveMechanicKioskPin,
} from "../../db/repositories/kiosk.repo.js";
import { invalidRequest, resourceNotFound } from "../../auth/errors.js";
import { KioskPinChangeRequiredError, KioskUnlockError } from "./kiosk-errors.js";

export function hashKioskDeviceToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createKioskDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export async function kioskContextForToken(token) {
  if (!token) return null;
  return getRegisteredKioskContext(hashKioskDeviceToken(token));
}

export async function registerKioskBrowser({
  companyId,
  locationId,
  name,
  actorUserId,
}) {
  const token = createKioskDeviceToken();
  const device = await createKioskDevice({
    companyId,
    locationId,
    name,
    tokenHash: hashKioskDeviceToken(token),
    actorUserId,
  });
  return { device, token };
}

export async function kioskDevicesForLocation(companyIds, locationId) {
  return listKioskDevices(companyIds, locationId);
}

export async function revokeRegisteredKiosk(input) {
  const device = await revokeKioskDevice(input);
  if (!device) throw resourceNotFound("Kiosk device");
  return device;
}

export async function issueMechanicKioskPin({
  companyIds,
  locationId,
  userId,
  pin,
  actorUserId,
}) {
  const mechanic = await getEligibleMechanicForKioskPin({
    companyIds,
    locationId,
    userId,
  });
  if (!mechanic) throw resourceNotFound("Mechanic");
  const pinHash = await hashPassword(pin);
  return saveMechanicKioskPin({
    userId,
    companyId: mechanic.company_id,
    pinHash,
    actorUserId,
  });
}

export async function beginKioskUnlock({
  deviceToken,
  mechanicId,
  pin,
  newPin,
}) {
  const result = await prepareKioskUnlock({
    tokenHash: hashKioskDeviceToken(deviceToken),
    mechanicId,
    pin,
    verifyPin: verifyPassword,
    hasNewPin: Boolean(newPin),
  });
  if (result.status === "locked") throw new KioskUnlockError("locked");
  if (result.status === "invalid") throw new KioskUnlockError("invalid");
  if (result.status === "pin_change_required") throw new KioskPinChangeRequiredError();
  if (newPin && newPin === pin) throw invalidRequest("New PIN must differ from temporary PIN.");
  return {
    prepared: result,
    newPinHash: newPin ? await hashPassword(newPin) : null,
  };
}

export async function finishKioskUnlock(input) {
  const completed = await completeKioskUnlock(input);
  if (!completed) throw new KioskUnlockError("invalid");
  return true;
}

export async function recordKioskEvent({ requestContext, type }) {
  if (requestContext?.sessionMode !== "kiosk") {
    throw invalidRequest("This action requires a kiosk session.");
  }
  const recorded = await recordKioskSessionEvent({
    sessionId: requestContext.session?.session?.id,
    actorUserId: requestContext.actor.id,
    type,
  });
  if (!recorded) throw invalidRequest("Kiosk session is no longer active.");
  return { recorded: true };
}
