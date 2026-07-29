function validationIssues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      return validationIssues(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (typeof value === "object") {
    if (Array.isArray(value.issues)) return value.issues;
    return validationIssues(value.error);
  }

  return [];
}

export function kioskPinFieldError(error) {
  const issues = [
    ...validationIssues(error?.details),
    ...validationIssues(error?.message),
  ];
  const pinIssue = issues.find((issue) => (
    Array.isArray(issue?.path)
    && issue.path.includes("pin")
    && typeof issue.message === "string"
  ));

  return pinIssue?.message || "";
}
