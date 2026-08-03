export function apiErrorDetails(body = {}) {
  if (typeof body?.error === "string") {
    return { code: body.code || "", message: body.error };
  }
  if (body?.error && typeof body.error === "object") {
    return {
      code: body.error.code || body.code || "",
      message: body.error.message || body.printMessage || "Request failed",
    };
  }
  return {
    code: body.code || "",
    message: body.printMessage || "Request failed",
  };
}

export async function api(path, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  const controller = timeoutMs > 0 && !fetchOptions.signal ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      ...fetchOptions,
      signal: fetchOptions.signal || controller?.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = apiErrorDetails(body);
      const error = new Error(details.message);
      error.code = details.code;
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request took too long. Try again.");
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
