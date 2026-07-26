import { useEffect, useRef } from "react";

export function useUnsavedBrowserGuard({
  hasUnsyncedChanges,
  flush,
  enabled = true,
  onFlushError,
}) {
  const flushRef = useRef(flush);
  const onFlushErrorRef = useRef(onFlushError);

  flushRef.current = flush;
  onFlushErrorRef.current = onFlushError;

  useEffect(() => {
    if (!enabled || !hasUnsyncedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      Promise.resolve(flushRef.current?.()).catch((error) => {
        onFlushErrorRef.current?.(error);
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, hasUnsyncedChanges]);
}
