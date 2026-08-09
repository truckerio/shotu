export function moduleRenderer(moduleId, renderers = {}) {
  return renderers[moduleId] || null;
}
