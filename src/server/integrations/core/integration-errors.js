export class IntegrationHttpError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "IntegrationHttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function integrationAuthenticationRequired(message = "A valid integration credential is required.") {
  return new IntegrationHttpError(401, "INTEGRATION_AUTHENTICATION_REQUIRED", message);
}

export function integrationPermissionDenied(message = "The integration credential lacks the required scope.") {
  return new IntegrationHttpError(403, "INTEGRATION_PERMISSION_DENIED", message);
}

export function integrationNotFound(resource = "Resource") {
  return new IntegrationHttpError(404, "INTEGRATION_RESOURCE_NOT_FOUND", `${resource} not found.`);
}

export function integrationConflict(code, message) {
  return new IntegrationHttpError(409, code, message);
}

export function integrationInvalidRequest(code, message, details = undefined) {
  return new IntegrationHttpError(400, code, message, details);
}

export function integrationUnprocessable(code, message, details = undefined) {
  return new IntegrationHttpError(422, code, message, details);
}
