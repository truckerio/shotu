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
    if (!response.ok) throw new Error(body.error || body.printMessage || "Request failed");
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request took too long. Try again.");
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
