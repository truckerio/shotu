export const KIOSK_DEVICE_COOKIE = "workorder.kiosk_device";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function cookieValue(header, name) {
  const cookies = String(header || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() !== name) continue;
    const value = cookie.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  return "";
}

export function kioskDeviceTokenFromCookie(header) {
  const token = cookieValue(header, KIOSK_DEVICE_COOKIE);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

export function kioskDeviceCookie(token, environment = process.env) {
  const attributes = [
    `${KIOSK_DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${ONE_YEAR_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (environment.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function expiredKioskDeviceCookie(environment = process.env) {
  const attributes = [
    `${KIOSK_DEVICE_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (environment.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}
