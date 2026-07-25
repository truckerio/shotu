export const partsHelperConfig = {
  enabled: process.env.PARTS_HELPER_ENABLED === "true",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.PARTS_HELPER_OPENAI_MODEL || "gpt-5.6-sol",
  openAiBaseUrl: process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
  huggingFaceDataset: process.env.PARTS_HELPER_HF_DATASET || "partsnow/us-heavy-duty-trucks",
  huggingFaceBaseUrl: process.env.HUGGINGFACE_DATASET_API_URL || "https://datasets-server.huggingface.co",
  huggingFaceToken: process.env.HF_TOKEN || "",
  huggingFaceCacheMinutes: Number(process.env.PARTS_HELPER_HF_CACHE_MINUTES || 360),
};

