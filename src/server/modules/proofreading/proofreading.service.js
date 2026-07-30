import { createWProofreaderProvider } from "./providers/wproofreader.provider.js";
import { resolveProofreadingConfig } from "./proofreading.config.js";

let cachedProvider;
let cachedSignature;

function configuredProvider() {
  const config = resolveProofreadingConfig();
  const signature = JSON.stringify(config);
  if (cachedProvider && cachedSignature === signature) return cachedProvider;

  if (config.provider !== "wproofreader") {
    throw new Error(`Unsupported proofreading provider: ${config.provider}.`);
  }
  cachedProvider = createWProofreaderProvider({
    serviceId: config.wproofreaderServiceId,
    timeoutMs: config.timeoutMs,
  });
  cachedSignature = signature;
  return cachedProvider;
}

export async function checkNarrativeText(input, { provider = configuredProvider() } = {}) {
  const issues = await provider.check(input);
  return { issues, provider: provider.name };
}
