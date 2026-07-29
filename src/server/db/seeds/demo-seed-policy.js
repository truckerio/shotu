export function assertLocalDemoSeed(environment = process.env, seedName = "Demo seed") {
  if (environment.NODE_ENV === "production") {
    throw new Error(`${seedName} is disabled in production.`);
  }
  if (environment.ALLOW_DEMO_USER_SEED !== "true") {
    throw new Error(`${seedName} requires ALLOW_DEMO_USER_SEED=true.`);
  }
}

export function resolveDemoUserPassword(environment = process.env) {
  assertLocalDemoSeed(environment, "Demo user seed");
  const password = String(environment.DEMO_USER_PASSWORD || "");
  if (!password) throw new Error("DEMO_USER_PASSWORD is required.");
  if (password.length < 12) {
    throw new Error("DEMO_USER_PASSWORD must contain at least 12 characters.");
  }
  return password;
}
