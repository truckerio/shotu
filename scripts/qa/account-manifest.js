const QA_ROLES = Object.freeze([
  Object.freeze({ role: "admin", label: "Admin" }),
  Object.freeze({ role: "office", label: "Office" }),
  Object.freeze({ role: "mechanic", label: "Mechanic" }),
  Object.freeze({ role: "surveillance", label: "Surveillance" }),
]);

export function normalizeQaNamespace(value = "qa") {
  const namespace = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(namespace)) {
    throw new Error("QA_ACCOUNT_NAMESPACE must be 1-31 lowercase letters, numbers, or hyphens.");
  }
  return namespace;
}

export function buildQaAccountManifest(namespaceValue = "qa") {
  const namespace = normalizeQaNamespace(namespaceValue);
  const usernameNamespace = namespace.replaceAll("-", "_");
  return QA_ROLES.map(({ role, label }) => Object.freeze({
    role,
    name: `QA ${label}`,
    username: `${usernameNamespace}.${role}`,
    email: `${namespace}.${role}@qa.invalid`,
  }));
}

export function publicAccountView(account) {
  return {
    role: account.role,
    name: account.name,
    username: account.username,
    email: account.email,
  };
}
