import { useEffect } from "react";
import { useFocusedFieldVisibility } from "./useFocusedFieldVisibility.js";
import { useVisualViewport } from "./useVisualViewport.js";

export function useOnscreenKeyboard() {
  const viewport = useVisualViewport();
  useFocusedFieldVisibility({
    enabled: true,
    keyboardOpen: viewport.keyboardOpen,
    margin: 32,
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.onscreenKeyboard = viewport.keyboardOpen ? "true" : "false";
    root.style.setProperty(
      "--onscreen-keyboard-viewport-height",
      viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
    );
    root.style.setProperty(
      "--onscreen-keyboard-viewport-offset-top",
      `${viewport.viewportOffsetTop}px`,
    );
    root.style.setProperty("--onscreen-keyboard-inset", `${viewport.keyboardInset}px`);
    return () => {
      delete root.dataset.onscreenKeyboard;
      root.style.removeProperty("--onscreen-keyboard-viewport-height");
      root.style.removeProperty("--onscreen-keyboard-viewport-offset-top");
      root.style.removeProperty("--onscreen-keyboard-inset");
    };
  }, [viewport.keyboardInset, viewport.keyboardOpen, viewport.viewportHeight, viewport.viewportOffsetTop]);

  return viewport;
}
