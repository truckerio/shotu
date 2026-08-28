export function isPlainPrimaryActivation(event = {}) {
  return (event.button ?? 0) === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}
