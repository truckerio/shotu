export function partsHelperEnabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

// Keep these values live so runtime-injected deployment variables are not
// frozen while the module graph is being initialized.
export const partsHelperConfig = {
  get enabled() {
    return partsHelperEnabled(process.env.PARTS_HELPER_ENABLED);
  },
  get openAiApiKey() {
    return process.env.OPENAI_API_KEY || "";
  },
  get openAiModel() {
    return process.env.PARTS_HELPER_OPENAI_MODEL || "gpt-5.6-sol";
  },
  get openAiBaseUrl() {
    return process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
  },
  get huggingFaceDataset() {
    return process.env.PARTS_HELPER_HF_DATASET || "partsnow/us-heavy-duty-trucks";
  },
  get huggingFaceBaseUrl() {
    return process.env.HUGGINGFACE_DATASET_API_URL || "https://datasets-server.huggingface.co";
  },
  get huggingFaceToken() {
    return process.env.HF_TOKEN || "";
  },
  get huggingFaceCacheMinutes() {
    return Number(process.env.PARTS_HELPER_HF_CACHE_MINUTES || 360);
  },
};
