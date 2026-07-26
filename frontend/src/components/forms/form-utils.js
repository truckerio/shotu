export function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export function normalizeFormErrors(errors) {
  if (!errors) return [];

  if (Array.isArray(errors)) {
    return errors
      .map((error, index) => {
        if (typeof error === "string") return { id: "", message: error, key: `error-${index}` };
        return {
          id: String(error?.id || error?.fieldId || ""),
          message: String(error?.message || ""),
          key: String(error?.key || error?.id || `error-${index}`),
        };
      })
      .filter((error) => error.message);
  }

  return Object.entries(errors)
    .map(([id, message]) => ({
      id,
      message: String(message || ""),
      key: id,
    }))
    .filter((error) => error.message);
}
