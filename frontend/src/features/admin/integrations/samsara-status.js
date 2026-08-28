export function samsaraPresentation(status) {
  const latestSync = status?.latestSync;
  const hasFailure = Boolean(
    status?.status === "error"
    || status?.error
    || status?.lastError
    || latestSync?.status === "failed"
    || latestSync?.hasError
    || latestSync?.error,
  );
  if (hasFailure) return { label: "Needs attention", tone: "error" };
  if (status?.connected || status?.configured || status?.status === "connected") return { label: "Connected", tone: "connected" };
  return { label: "Not connected", tone: "disconnected" };
}

export function samsaraCardState(status, actionError = "") {
  if (actionError || samsaraPresentation(status).tone === "error") return "error";
  return status?.connected || status?.configured || status?.status === "connected" ? "connected" : "disconnected";
}
