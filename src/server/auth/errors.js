export class AuthError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function authenticationRequired() {
  return new AuthError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
}

export function permissionDenied() {
  return new AuthError(403, "PERMISSION_DENIED", "Permission denied.");
}

export function resourceNotFound(resource = "Resource") {
  return new AuthError(404, "RESOURCE_NOT_FOUND", `${resource} not found.`);
}
