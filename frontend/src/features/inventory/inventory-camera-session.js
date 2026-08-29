export function createInventoryCameraSession() {
  let generation = 0;
  let starting = false;

  return {
    begin() {
      if (starting) return null;
      starting = true;
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    stopIfStale(token, stream) {
      if (token === generation) return false;
      stream?.getTracks?.().forEach((track) => track.stop());
      return true;
    },
    finish(token) {
      if (token === generation) starting = false;
    },
    cancel() {
      generation += 1;
      starting = false;
    },
  };
}
