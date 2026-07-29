const providers = new Map();

export function registerIntegrationProvider(adapter) {
  if (!adapter?.provider) throw new TypeError("Integration adapter requires a provider name.");
  if (providers.has(adapter.provider)) {
    throw new Error(`Integration provider is already registered: ${adapter.provider}`);
  }
  providers.set(adapter.provider, Object.freeze(adapter));
  return adapter;
}

export function getIntegrationProvider(provider) {
  const adapter = providers.get(provider);
  if (!adapter) throw new Error(`Unsupported integration provider: ${provider}`);
  return adapter;
}

export function listIntegrationProviders() {
  return [...providers.values()].map(({ provider, capabilities = [] }) => ({
    provider,
    capabilities: [...capabilities],
  }));
}

export function getIntegrationJobHandler(provider, jobType) {
  const adapter = getIntegrationProvider(provider);
  const handler = adapter.jobs?.[jobType];
  if (typeof handler !== "function") {
    throw new Error(`Unsupported integration job: ${provider}/${jobType}`);
  }
  return handler;
}

export function clearIntegrationProvidersForTest() {
  providers.clear();
}
