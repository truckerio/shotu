import { useOnscreenKeyboard } from "../../hooks/useOnscreenKeyboard.js";

export function OnscreenKeyboardRoot({ children }) {
  useOnscreenKeyboard();
  return children;
}
